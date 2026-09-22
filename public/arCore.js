import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// Filter out non-fatal duplicate Three.js instance warning caused by model-viewer co-existing with Three.js ESM
const originalWarn = console.warn;
console.warn = function (...args) {
  if (args[0] && typeof args[0] === "string" && args[0].includes("Multiple instances of Three.js")) {
    return;
  }
  originalWarn.apply(console, args);
};

/**
 * Interactive WebXR AR Core Manager for Lanica Furniture
 * Provides multi-object placement, scanning HUD, floor ring guides,
 * lift/drop lerp physics, shadow control, raycast selection, clean deletion,
 * and real-time PBR material color overrides.
 */
export class ARCoreManager {
  constructor() {
    this.session = null;
    this.xrRefSpace = null;
    this.viewerSpace = null;
    this.hitTestSource = null;

    // Three.js Core
    this.container = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.gltfLoader = new GLTFLoader();

    // Floor & Hit Test State
    this.reticle = null;
    this.lastHitPoseMatrix = null;
    this.hasValidHitPose = false;

    // Placed Objects State
    // Item structure: { id, productId, name, modelGroup, originalMaterialsMap, currentLift, targetLift, groundY, isLifted, colorHex }
    this.placedItems = new Map(); // key: productId
    this.activeProductId = null; // currently selected object ID in scene

    // Selected Catalog Item to Place
    this.catalogProducts = [];
    this.selectedCatalogProductId = null;

    // UI Overlay Elements
    this.overlayEl = null;
    this.hudBannerText = null;
    this.hudStatusDot = null;
    this.catalogCarouselEl = null;
    this.itemControlsEl = null;
    this.deleteBtn = null;
    this.colorPaletteEl = null;

    // Interactive Drag / Raycast State
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.isDragging = false;
    this.draggedItem = null;
    this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    // Fallback Mode Flag (for non-WebXR devices)
    this.isFallbackMode = false;
  }

  /**
   * Launch WebXR AR Session or Fallback to 3D Model Viewer on Non-WebXR Devices
   * @param {Array} catalogProducts - Array of product objects from Firestore
   * @param {string} initialProductId - ID of product to pre-select
   * @param {Function} fallbackViewerCallback - Callback to show standard 3D Model Viewer modal on PC/non-WebXR devices
   */
  async launchAR(catalogProducts = [], initialProductId = null, fallbackViewerCallback = null) {
    this.catalogProducts = catalogProducts;
    if (initialProductId) {
      this.selectedCatalogProductId = initialProductId;
    } else if (catalogProducts.length > 0) {
      this.selectedCatalogProductId = catalogProducts[0].id;
    }

    // Check WebXR AR Support
    let isWebXRSupported = false;
    if (navigator.xr && typeof navigator.xr.isSessionSupported === "function") {
      try {
        isWebXRSupported = await navigator.xr.isSessionSupported("immersive-ar");
      } catch (e) {
        isWebXRSupported = false;
      }
    }

    if (isWebXRSupported) {
      this.buildOverlayUI();
      try {
        await this.startWebXRSession();
      } catch (err) {
        console.warn("WebXR Session request failed:", err);
        if (fallbackViewerCallback) {
          fallbackViewerCallback(this.selectedCatalogProductId);
        } else {
          this.startFallbackMode();
        }
      }
    } else {
      console.log("WebXR immersive-ar not supported on this device/PC browser. Showing 3D Model Viewer modal.");
      if (fallbackViewerCallback) {
        fallbackViewerCallback(this.selectedCatalogProductId);
      } else {
        this.startFallbackMode();
      }
    }
  }

  /**
   * Start Native WebXR Immersive AR Session
   */
  async startWebXRSession() {
    this.isFallbackMode = false;
    this.setupThreeScene();

    // Request WebXR session with hit-test required and dom-overlay optional
    const session = await navigator.xr.requestSession("immersive-ar", {
      requiredFeatures: ["hit-test"],
      optionalFeatures: ["dom-overlay"],
      domOverlay: { root: this.overlayEl },
    });

    this.session = session;
    this.renderer.xr.enabled = true;
    await this.renderer.xr.setSession(session);

    // Reference Spaces
    this.xrRefSpace = await session.requestReferenceSpace("local");
    this.viewerSpace = await session.requestReferenceSpace("viewer");

    // Hit-Test Source
    this.hitTestSource = await session.requestHitTestSource({ space: this.viewerSpace });

    // Events
    session.addEventListener("end", () => this.onSessionEnded());
    session.addEventListener("select", (e) => this.onWebXRSelect(e));

    // Animation Render Loop
    this.renderer.setAnimationLoop((timestamp, frame) => this.renderWebXRFrame(timestamp, frame));
  }

  /**
   * Start Interactive 3D Fallback Mode for Non-WebXR Devices
   */
  startFallbackMode() {
    this.isFallbackMode = true;
    if (this.overlayEl) {
      this.overlayEl.classList.add("fallback-mode");
    }
    this.setupThreeScene();

    // Append renderer to overlay canvas container
    const canvasWrapper = this.overlayEl.querySelector(".ar-canvas-container");
    canvasWrapper.appendChild(this.renderer.domElement);
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    // Update HUD Text for Fallback Mode
    this.setHUDText("PHASE_2", "TAP GROUND GRID TO PLACE ITEM");

    // Add visual floor grid helper for fallback mode
    const gridHelper = new THREE.GridHelper(20, 20, 0xfcd535, 0x444444);
    gridHelper.position.y = 0;
    this.scene.add(gridHelper);

    // Setup Camera for 3D View
    this.camera.position.set(0, 1.8, 3.2);
    this.camera.lookAt(0, 0.5, 0);

    // Initialize OrbitControls for PC/Desktop navigation
    try {
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.05;
      this.controls.target.set(0, 0.5, 0);
    } catch (e) {
      console.warn("OrbitControls initialization warning:", e);
    }

    // Event listeners for fallback touch/mouse interaction
    this.bindFallbackTouchEvents();

    // Render loop
    const animate = () => {
      if (!this.isFallbackMode) return;
      requestAnimationFrame(animate);
      if (this.controls) this.controls.update();
      this.updatePhysics();
      this.renderer.render(this.scene, this.camera);
    };
    animate();
  }

  /**
   * Initialize Three.js Scene, Camera, Lights, and Reticle
   */
  setupThreeScene() {
    this.scene = new THREE.Scene();
    if (this.isFallbackMode) {
      this.scene.background = new THREE.Color(0x0f1115);
    }
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Lighting setup for realistic PBR furniture rendering
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(2.5, 5, 2.5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 0.1;
    dirLight.shadow.camera.far = 10;
    this.scene.add(dirLight);

    // Ground Ring Guide / Reticle
    // RingGeometry(0.79, 0.80, 64) - Thin, semi-transparent white ring (opacity ~0.65, unlit)
    const ringGeo = new THREE.RingGeometry(0.79, 0.8, 64);
    ringGeo.rotateX(-Math.PI / 2); // rotate horizontally to lie flat on floor plane
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.65,
      depthTest: true,
    });
    this.reticle = new THREE.Mesh(ringGeo, ringMat);
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    this.scene.add(this.reticle);
  }

  /**
   * Build HUD, Controls, and Catalog Carousel Overlay UI
   */
  buildOverlayUI() {
    // Clean existing overlay if present
    if (this.overlayEl) this.overlayEl.remove();

    this.overlayEl = document.createElement("div");
    this.overlayEl.id = "webxr-ar-overlay";
    this.overlayEl.className = "webxr-ar-overlay active";

    this.overlayEl.innerHTML = `
      <div class="ar-canvas-container"></div>

      <!-- Top Two-Phase Scanning HUD Instruction Banner -->
      <div class="ar-hud-banner" id="ar-hud-banner">
        <div class="ar-hud-badge">
          <span class="ar-hud-dot" id="ar-hud-dot"></span>
          <span class="ar-hud-text" id="ar-hud-text">MOVE PHONE TO SCAN FLOOR</span>
        </div>
      </div>

      <!-- Close Session Button -->
      <button class="ar-close-btn" id="ar-close-btn" aria-label="Exit AR Session">&times;</button>

      <!-- Active Item Controls (Delete Item & Color Palette) -->
      <div class="ar-item-controls hidden" id="ar-item-controls">
        <div class="ar-item-header">
          <span class="ar-active-title" id="ar-active-title">Selected Furniture</span>
          <button class="ar-delete-btn" id="ar-delete-btn">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            <span>DELETE ITEM</span>
          </button>
        </div>
        <div class="ar-color-picker" id="ar-color-picker">
          <span class="color-label">Color Tint:</span>
          <div class="color-swatches">
            <button class="swatch active" data-color="default" style="background: #ffffff;" title="Original Material"></button>
            <button class="swatch" data-color="#e74c3c" style="background: #e74c3c;" title="Crimson Red"></button>
            <button class="swatch" data-color="#2980b9" style="background: #2980b9;" title="Navy Blue"></button>
            <button class="swatch" data-color="#2ecc71" style="background: #2ecc71;" title="Emerald Green"></button>
            <button class="swatch" data-color="#f1c40f" style="background: #f1c40f;" title="Amber Gold"></button>
            <button class="swatch" data-color="#34495e" style="background: #34495e;" title="Charcoal Black"></button>
          </div>
        </div>
      </div>

      <!-- Bottom Anchored Catalog Carousel -->
      <div class="ar-catalog-container">
        <div class="ar-catalog-title">Catalog Furniture</div>
        <div class="ar-catalog-carousel" id="ar-catalog-carousel"></div>
      </div>
    `;

    document.body.appendChild(this.overlayEl);

    // Cache DOM refs
    this.hudBannerText = this.overlayEl.querySelector("#ar-hud-text");
    this.hudStatusDot = this.overlayEl.querySelector("#ar-hud-dot");
    this.catalogCarouselEl = this.overlayEl.querySelector("#ar-catalog-carousel");
    this.itemControlsEl = this.overlayEl.querySelector("#ar-item-controls");
    this.deleteBtn = this.overlayEl.querySelector("#ar-delete-btn");
    this.colorPaletteEl = this.overlayEl.querySelector("#ar-color-picker");

    // Close button listener
    this.overlayEl.querySelector("#ar-close-btn").addEventListener("click", () => this.endSession());

    // Delete item listener
    this.deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.deleteActiveItem();
    });

    // Color swatches listener
    this.colorPaletteEl.querySelectorAll(".swatch").forEach((swatch) => {
      swatch.addEventListener("click", (e) => {
        e.stopPropagation();
        this.colorPaletteEl.querySelectorAll(".swatch").forEach((s) => s.classList.remove("active"));
        swatch.classList.add("active");
        const colorVal = swatch.getAttribute("data-color");
        this.applyColorOverrideToActiveItem(colorVal === "default" ? null : colorVal);
      });
    });

    // Render Catalog Carousel Cards
    this.renderCatalogCarousel();
  }

  /**
   * Set HUD Status Banner Text and State
   */
  setHUDText(phase, customMsg = null) {
    if (!this.hudBannerText || !this.hudStatusDot) return;

    if (phase === "PHASE_1") {
      this.hudBannerText.textContent = customMsg || "MOVE PHONE TO SCAN FLOOR";
      this.hudStatusDot.className = "ar-hud-dot scanning";
    } else if (phase === "PHASE_2") {
      this.hudBannerText.textContent = customMsg || "TAP THE FLOOR TO PLACE ITEM";
      this.hudStatusDot.className = "ar-hud-dot ready";
    }
  }

  /**
   * Render Bottom Catalog Carousel with Product Cards & Single-Piece Rules
   */
  renderCatalogCarousel() {
    if (!this.catalogCarouselEl) return;
    this.catalogCarouselEl.innerHTML = "";

    if (!this.catalogProducts || this.catalogProducts.length === 0) {
      // Create fallback catalog cards if empty
      this.catalogProducts = [
        { id: "chair_01", name: "Modern Chair", price: "4,500", image: "assets/product_chair.png" },
        { id: "sofa_01", name: "Luxe Sofa", price: "18,900", image: "assets/product_sofa.png" },
        { id: "lamp_01", name: "Nordic Lamp", price: "3,200", image: "assets/product_lamp.png" },
      ];
    }

    this.catalogProducts.forEach((prod) => {
      const isPlaced = this.placedItems.has(prod.id);
      const isSelected = this.selectedCatalogProductId === prod.id;

      const card = document.createElement("div");
      card.className = `ar-catalog-card ${isSelected ? "selected" : ""} ${isPlaced ? "placed" : ""}`;
      card.setAttribute("data-product-id", prod.id);

      const displayImg =
        prod.thumbnail ||
        (prod.images && (prod.images.isoImage || prod.images.frontBg)) ||
        prod.image ||
        "assets/product_sofa.png";

      card.innerHTML = `
        <div class="ar-card-img-wrap">
          <img src="${displayImg}" alt="${prod.name}" class="ar-card-img" onerror="this.onerror=null;this.src='assets/product_sofa.png'">
          ${isPlaced ? '<span class="ar-placed-badge">Placed</span>' : ""}
        </div>
        <div class="ar-card-info">
          <span class="ar-card-name">${prod.name}</span>
        </div>
      `;

      if (!isPlaced) {
        card.addEventListener("click", (e) => {
          e.stopPropagation();
          this.selectCatalogProduct(prod.id);
        });
      }

      this.catalogCarouselEl.appendChild(card);
    });
  }

  /**
   * Select a Catalog Item from Carousel
   */
  selectCatalogProduct(productId) {
    if (this.placedItems.has(productId)) return; // Single-Piece Rule

    this.selectedCatalogProductId = productId;
    this.renderCatalogCarousel();

    // Deselect active scene item if placing a new catalog item
    this.setActiveItem(null);
  }

  /**
   * WebXR Animation Frame Render Loop
   */
  renderWebXRFrame(timestamp, frame) {
    if (!frame) return;

    // 1. Process Hit-Test Result
    if (this.hitTestSource) {
      const hitTestResults = frame.getHitTestResults(this.hitTestSource);
      if (hitTestResults.length > 0) {
        const hit = hitTestResults[0];
        const pose = hit.getPose(this.xrRefSpace);

        if (pose) {
          this.hasValidHitPose = true;
          this.lastHitPoseMatrix = pose.transform.matrix;

          // If no active item selected in scene, move reticle to floor hit pose
          if (!this.activeProductId) {
            this.reticle.visible = true;
            this.reticle.matrix.fromArray(pose.transform.matrix);
          }

          // Dynamic HUD Banner: Phase 2 Ready
          this.setHUDText("PHASE_2");
        } else {
          this.hasValidHitPose = false;
          if (!this.activeProductId) this.reticle.visible = false;
          this.setHUDText("PHASE_1");
        }
      } else {
        this.hasValidHitPose = false;
        if (!this.activeProductId) this.reticle.visible = false;
        this.setHUDText("PHASE_1");
      }
    }

    // 2. Update Lift/Drop Physics & Lerp Animations at 60fps
    this.updatePhysics();

    // 3. Render Three.js Scene
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Smooth Lift & Drop Lerp Physics Animation Loop (+0.25m lift)
   */
  updatePhysics() {
    this.placedItems.forEach((item) => {
      // Lerp Lift Position: currentLift += (targetLift - currentLift) * 0.15
      const liftDelta = (item.targetLift - item.currentLift) * 0.15;
      item.currentLift += liftDelta;

      // Update mesh vertical height
      item.modelGroup.position.y = item.groundY + item.currentLift;

      // Shadow toggling rule:
      // While lifted (targetLift > 0 or currentLift > 0.01), castShadow = false
      // Once fully grounded (currentLift <= 0.01), castShadow = true
      const isLifted = item.currentLift > 0.01 || item.targetLift > 0;
      if (item.isLifted !== isLifted) {
        item.isLifted = isLifted;
        item.modelGroup.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = !isLifted;
          }
        });
      }
    });

    // Pin Ground Ring Reticle directly under active selected item if present
    if (this.activeProductId && this.placedItems.has(this.activeProductId)) {
      const activeItem = this.placedItems.get(this.activeProductId);
      this.reticle.visible = true;
      this.reticle.position.set(
        activeItem.modelGroup.position.x,
        activeItem.groundY + 0.005, // pin flat to floor
        activeItem.modelGroup.position.z
      );
      this.reticle.matrixAutoUpdate = true;
    }
  }

  /**
   * WebXR Select / Floor Tap Event Handler
   */
  async onWebXRSelect(event) {
    // If tap was on UI Overlay elements, ignore
    if (event && event.domOverlayState && event.domOverlayState.action === "dismiss") return;

    // Check Raycast against existing placed furniture items first
    const controllerPose = event.frame.getPose(event.inputSource.targetRaySpace, this.xrRefSpace);
    if (controllerPose) {
      const tempMatrix = new THREE.Matrix4().fromArray(controllerPose.transform.matrix);
      const origin = new THREE.Vector3().setFromMatrixPosition(tempMatrix);
      const direction = new THREE.Vector3(0, 0, -1).applyMatrix4(tempMatrix).sub(origin).normalize();

      this.raycaster.set(origin, direction);
      const intersects = this.raycaster.intersectObjects(this.scene.children, true);

      // Check if tap hit a placed model mesh
      for (const hit of intersects) {
        let curr = hit.object;
        while (curr && curr.parent && curr.parent !== this.scene) {
          if (curr.userData && curr.userData.productId) {
            this.setActiveItem(curr.userData.productId);
            return;
          }
          curr = curr.parent;
        }
      }
    }

    // If no placed model was tapped, check if we have a valid floor hit-test pose to spawn selected catalog model
    if (this.hasValidHitPose && this.selectedCatalogProductId && !this.placedItems.has(this.selectedCatalogProductId)) {
      const spawnMatrix = new THREE.Matrix4().fromArray(this.lastHitPoseMatrix);
      const spawnPos = new THREE.Vector3().setFromMatrixPosition(spawnMatrix);

      await this.spawnFurnitureItem(this.selectedCatalogProductId, spawnPos);
    }
  }

  /**
   * Fallback Mouse / Touch Event Binds for 3D Studio AR Mode
   */
  bindFallbackTouchEvents() {
    const dom = this.renderer.domElement;

    const getNDCCoords = (e) => {
      const rect = dom.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      );
    };

    const handlePointerDown = (e) => {
      // Ignore click if clicking on overlay controls
      if (e.target.closest(".ar-item-controls") || e.target.closest(".ar-catalog-container") || e.target.closest("#ar-close-btn")) {
        return;
      }

      this.mouse = getNDCCoords(e);
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const intersects = this.raycaster.intersectObjects(this.scene.children, true);

      let hitProductId = null;
      for (const hit of intersects) {
        let curr = hit.object;
        while (curr && curr.parent && curr.parent !== this.scene) {
          if (curr.userData && curr.userData.productId) {
            hitProductId = curr.userData.productId;
            break;
          }
          curr = curr.parent;
        }
        if (hitProductId) break;
      }

      if (hitProductId) {
        this.setActiveItem(hitProductId);
        this.isDragging = true;
        if (this.controls) this.controls.enabled = false;
        this.draggedItem = this.placedItems.get(hitProductId);
        if (this.draggedItem) {
          this.draggedItem.targetLift = 0.25; // Apply +0.25m lift on drag start
        }
      } else {
        // Tap on floor plane
        const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const intersectPt = new THREE.Vector3();
        if (this.raycaster.ray.intersectPlane(floorPlane, intersectPt)) {
          if (this.selectedCatalogProductId && !this.placedItems.has(this.selectedCatalogProductId)) {
            this.spawnFurnitureItem(this.selectedCatalogProductId, intersectPt);
          } else {
            this.setActiveItem(null);
          }
        }
      }
    };

    const handlePointerMove = (e) => {
      if (!this.isDragging || !this.draggedItem) return;
      this.mouse = getNDCCoords(e);
      this.raycaster.setFromCamera(this.mouse, this.camera);

      const intersectPt = new THREE.Vector3();
      this.dragPlane.constant = -this.draggedItem.groundY;
      if (this.raycaster.ray.intersectPlane(this.dragPlane, intersectPt)) {
        this.draggedItem.modelGroup.position.x = intersectPt.x;
        this.draggedItem.modelGroup.position.z = intersectPt.z;
      }
    };

    const handlePointerUp = () => {
      if (this.controls) this.controls.enabled = true;
      if (this.isDragging && this.draggedItem) {
        this.draggedItem.targetLift = 0.0; // Drop back to floor plane on release
        this.draggedItem = null;
        this.isDragging = false;
      }
    };

    dom.addEventListener("mousedown", handlePointerDown);
    dom.addEventListener("mousemove", handlePointerMove);
    dom.addEventListener("mouseup", handlePointerUp);

    dom.addEventListener("touchstart", handlePointerDown, { passive: true });
    dom.addEventListener("touchmove", handlePointerMove, { passive: true });
    dom.addEventListener("touchend", handlePointerUp);
  }

  /**
   * Spawn Selected Catalog Furniture Item into Three.js Scene
   */
  async spawnFurnitureItem(productId, position) {
    // Enforce Single-Piece Rule
    if (this.placedItems.has(productId)) {
      console.warn("Single-Piece Rule: Duplicate spawn blocked for product ID", productId);
      return;
    }

    const prodData = this.catalogProducts.find((p) => p.id === productId) || {
      id: productId,
      name: "Furniture",
      price: "0",
    };

    const modelGroup = new THREE.Group();
    modelGroup.position.copy(position);
    modelGroup.position.y = position.y;
    modelGroup.userData.productId = productId;

    // Load 3D GLTF/GLB or create stylized procedural model
    const rawUrl = prodData.modelUrl || prodData.glbUrl || prodData.arModelUrl;
    let loadedMesh = null;

    if (rawUrl) {
      try {
        const gltf = await this.loadGLTFPromise(rawUrl);
        loadedMesh = gltf.scene;
      } catch (err) {
        console.warn("Failed to load custom GLTF, generating procedural fallback model:", err);
        loadedMesh = this.createProceduralFurnitureMesh(prodData.name);
      }
    } else {
      loadedMesh = this.createProceduralFurnitureMesh(prodData.name);
    }

    // Auto-scale & normalize geometry bounds
    const box = new THREE.Box3().setFromObject(loadedMesh);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const targetScale = 1.0 / (maxDim || 1.0); // Normalize to ~1 meter
    loadedMesh.scale.setScalar(targetScale);

    // Reposition mesh base to floor level (Y=0)
    const normalizedBox = new THREE.Box3().setFromObject(loadedMesh);
    loadedMesh.position.y = -normalizedBox.min.y;

    // Configure shadows and material cloning cache
    const originalMaterialsMap = new Map();
    loadedMesh.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material) {
          const matClone = child.material.clone();
          child.material = matClone;
          originalMaterialsMap.set(child.uuid, matClone.clone());
        }
      }
    });

    modelGroup.add(loadedMesh);
    this.scene.add(modelGroup);

    // Create Item State Record
    const itemRecord = {
      id: productId,
      productId: productId,
      name: prodData.name,
      modelGroup: modelGroup,
      originalMaterialsMap: originalMaterialsMap,
      groundY: position.y,
      currentLift: 0.0,
      targetLift: 0.0,
      isLifted: false,
      colorHex: null,
    };

    this.placedItems.set(productId, itemRecord);

    // Update Catalog Carousel UI (disable placed product)
    this.renderCatalogCarousel();

    // Automatically set newly spawned model as active selected item
    this.setActiveItem(productId);
  }

  /**
   * Helper Promise wrapper for GLTFLoader
   */
  loadGLTFPromise(url) {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => resolve(gltf),
        undefined,
        (err) => reject(err)
      );
    });
  }

  /**
   * Create Styled Procedural 3D Furniture Mesh (Chair/Sofa/Table) Fallback
   */
  createProceduralFurnitureMesh(name = "") {
    const group = new THREE.Group();
    const isSofa = name.toLowerCase().includes("sofa");
    const isLamp = name.toLowerCase().includes("lamp");

    const woodMat = new THREE.MeshStandardMaterial({ color: 0x8e5a2b, roughness: 0.5 });
    const fabricMat = new THREE.MeshStandardMaterial({ color: 0x34495e, roughness: 0.8 });

    if (isSofa) {
      // Base cushion
      const cushion = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.4, 0.8), fabricMat);
      cushion.position.y = 0.3;
      group.add(cushion);

      // Backrest
      const back = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 0.2), fabricMat);
      back.position.set(0, 0.7, -0.3);
      group.add(back);

      // Armrests
      const armL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.8), fabricMat);
      armL.position.set(-0.9, 0.45, 0);
      const armR = armL.clone();
      armR.position.x = 0.9;
      group.add(armL, armR);
    } else if (isLamp) {
      // Base & Pole
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.2, 1.4, 16), woodMat);
      pole.position.y = 0.7;
      group.add(pole);

      // Shade
      const shadeMat = new THREE.MeshStandardMaterial({ color: 0xf39c12, roughness: 0.3 });
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 0.4, 32), shadeMat);
      shade.position.y = 1.3;
      group.add(shade);
    } else {
      // Modern Chair
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.6), fabricMat);
      seat.position.y = 0.5;
      group.add(seat);

      const back = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.06), fabricMat);
      back.position.set(0, 0.75, -0.27);
      group.add(back);

      // Legs
      const legGeo = new THREE.CylinderGeometry(0.03, 0.02, 0.5, 12);
      const offsets = [
        [-0.25, 0.25, 0.25],
        [0.25, 0.25, 0.25],
        [-0.25, 0.25, -0.25],
        [0.25, 0.25, -0.25],
      ];
      offsets.forEach(([x, y, z]) => {
        const leg = new THREE.Mesh(legGeo, woodMat);
        leg.position.set(x, y, z);
        group.add(leg);
      });
    }

    return group;
  }

  /**
   * Set Active Selected Furniture Item in Scene
   */
  setActiveItem(productId) {
    this.activeProductId = productId;

    if (productId && this.placedItems.has(productId)) {
      const item = this.placedItems.get(productId);

      // Reveal Item Controls Floating Overlay
      this.itemControlsEl.classList.remove("hidden");
      this.overlayEl.querySelector("#ar-active-title").textContent = item.name;

      // Update Color Swatch Active Highlight
      this.colorPaletteEl.querySelectorAll(".swatch").forEach((s) => {
        const swColor = s.getAttribute("data-color");
        if ((!item.colorHex && swColor === "default") || item.colorHex === swColor) {
          s.classList.add("active");
        } else {
          s.classList.remove("active");
        }
      });
    } else {
      // Hide Item Controls Overlay
      this.itemControlsEl.classList.add("hidden");
      if (!this.hasValidHitPose) {
        this.reticle.visible = false;
      }
    }
  }

  /**
   * Real-time Live Material / Color Override with Emissive Intensity (~0.2)
   */
  applyColorOverrideToActiveItem(hexColor) {
    if (!this.activeProductId || !this.placedItems.has(this.activeProductId)) return;

    const item = this.placedItems.get(this.activeProductId);
    item.colorHex = hexColor;

    item.modelGroup.traverse((child) => {
      if (child.isMesh && child.material) {
        if (!hexColor) {
          // Restore original material state
          const origMat = item.originalMaterialsMap.get(child.uuid);
          if (origMat) {
            child.material = origMat.clone();
            child.material.needsUpdate = true;
          }
        } else {
          // Ensure material is cloned so changes do not mutate other instances or cached assets
          child.material = child.material.clone();

          // Set material.color (baseColorFactor)
          child.material.color.set(hexColor);

          // Set material.emissive (emissiveFactor) with an emissiveIntensity of ~0.2
          if (child.material.emissive) {
            child.material.emissive.set(hexColor);
            child.material.emissiveIntensity = 0.2;
          }

          child.material.needsUpdate = true;
        }
      }
    });
  }

  /**
   * Delete Active Item with Full WebGL Memory Cleanup
   */
  deleteActiveItem() {
    if (!this.activeProductId || !this.placedItems.has(this.activeProductId)) return;

    const productId = this.activeProductId;
    const item = this.placedItems.get(productId);

    // 1. Remove from Three.js Scene
    this.scene.remove(item.modelGroup);

    // 2. Cleanly dispose of geometries, materials, and textures from GPU memory
    item.modelGroup.traverse((child) => {
      if (child.isMesh) {
        if (child.geometry) {
          child.geometry.dispose();
        }
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => this.disposeMaterial(m));
          } else {
            this.disposeMaterial(child.material);
          }
        }
      }
    });

    // 3. Clear from placed state
    this.placedItems.delete(productId);

    // 4. Reset active selection
    this.setActiveItem(null);

    // 5. Re-enable item in catalog carousel
    this.renderCatalogCarousel();
  }

  /**
   * Helper: Dispose material and attached textures
   */
  disposeMaterial(material) {
    if (!material) return;
    Object.keys(material).forEach((prop) => {
      if (material[prop] && typeof material[prop].dispose === "function") {
        material[prop].dispose();
      }
    });
    material.dispose();
  }

  /**
   * End WebXR AR Session / Clean Up
   */
  async endSession() {
    if (this.session) {
      try {
        await this.session.end();
      } catch (e) {
        console.warn("Session end error:", e);
      }
    }
    this.onSessionEnded();
  }

  /**
   * Handle WebXR Session Ended & Resource Teardown
   */
  onSessionEnded() {
    this.session = null;
    this.isFallbackMode = false;

    if (this.controls) {
      this.controls.dispose();
      this.controls = null;
    }

    // Dispose all placed objects
    Array.from(this.placedItems.keys()).forEach(() => {
      this.activeProductId = Array.from(this.placedItems.keys())[0];
      this.deleteActiveItem();
    });

    // Dispose renderer
    if (this.renderer) {
      this.renderer.setAnimationLoop(null);
      this.renderer.dispose();
    }

    // Remove Overlay Element
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
  }
}

// Instantiate Singleton Core Instance
export const arCoreManager = new ARCoreManager();
