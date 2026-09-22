/**
 * Lanica Web AR Core Engine
 * High-end WebAR experience with Three.js & WebXR hit testing.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";


export class LanicaWebAR {
  constructor(options = {}) {
    this.initialProduct = options.product || null;
    this.catalog = options.catalog || [];
    this.onClose = options.onClose || (() => {});

    this.container = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.controls = null;
    this.gltfLoader = new GLTFLoader();

    // State
    this.placedObjects = []; // { id, productId, name, modelMesh, shadowMesh, color, baseY, currentY, targetY, isLifted, liftProgress, position }
    this.placedProductIds = new Set();
    this.selectedCatalogItem = this.initialProduct;
    this.selectedPlacedObject = null;
    this.activeColor = "#ffffff";
    this.xrSession = null;
    this.hitTestSource = null;
    this.hitTestSourceRequested = false;

    // Phase state: 1 = Scan Floor, 2 = Tap Floor to Place
    this.arPhase = 1;
    this.planeDetected = false;

    // Reticle & Floor Ring
    this.reticle = null;
    this.reticleRing = null;
    this.floorPlane = null;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Drag state
    this.isDragging = false;
    this.draggedObject = null;
    this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.dragIntersection = new THREE.Vector3();

    // UI elements
    this.hudBanner = null;
    this.carouselEl = null;
    this.colorToolbarEl = null;
    this.deleteBtnEl = null;
    this.toastEl = null;

    // Colors list
    this.colorPalette = [
      { name: "Default", hex: "#FFFFFF" },
      { name: "Natural Oak", hex: "#D4A373" },
      { name: "Dark Walnut", hex: "#4A3525" },
      { name: "Midnight Black", hex: "#1A1A1A" },
      { name: "Forest Green", hex: "#2D5A27" },
      { name: "Royal Navy", hex: "#1B2A4A" },
      { name: "Terracotta", hex: "#C86D51" },
    ];
  }

  // Perform HTTP HEAD check on asset URL to validate link availability
  static async validateModelAsset(url) {
    if (!url) return false;
    try {
      const response = await fetch(url, { method: "HEAD", mode: "cors" });
      if (response.ok) return true;
      // Fallback: If HEAD gets 405 Method Not Allowed or CORS restrictions, attempt a lightweight range GET
      const getResponse = await fetch(url, { method: "GET", headers: { Range: "bytes=0-10" }, mode: "cors" });
      return getResponse.ok || getResponse.status === 206;
    } catch (err) {
      console.warn("Asset HEAD validation failed for:", url, err);
      return true;
    }
  }

  async start() {
    // Validate current product model link if available
    const rawUrl = this.initialProduct?.modelUrl || this.initialProduct?.glbUrl;
    if (rawUrl) {
      const isValid = await LanicaWebAR.validateModelAsset(rawUrl);
      if (!isValid) {
        this.showToast("Warning: 3D asset link is unreachable. Fallback preview active.", "error");
      }
    }

    this.createUI();
    this.initThreeJS();
    this.setupReticle();
    this.animate();
  }

  createUI() {
    this.container = document.createElement("div");
    this.container.className = "lanica-webar-overlay active";
    this.container.innerHTML = `
      <!-- Top HUD Banner -->
      <div class="ar-hud-banner phase-1" id="ar-hud-banner">
        <div class="ar-hud-icon pulse"></div>
        <span id="ar-hud-text">MOVE PHONE TO SCAN FLOOR</span>
      </div>

      <!-- Close Button -->
      <button class="ar-close-btn" id="ar-close-btn" title="Exit AR">&times;</button>

      <!-- WebXR AR Launch Button (for WebXR supported devices) -->
      <button class="ar-webxr-launch-btn" id="ar-webxr-launch-btn" style="display: none;">
        <span>Enter Mobile WebXR AR</span>
      </button>

      <!-- Floating Delete Item Button -->
      <button class="ar-delete-btn" id="ar-delete-btn" style="display: none;">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
        <span>DELETE ITEM</span>
      </button>

      <!-- Canvas Container -->
      <div class="ar-canvas-container" id="ar-canvas-container"></div>

      <!-- Color Palette Toolbar -->
      <div class="ar-color-toolbar" id="ar-color-toolbar">
        <div class="ar-toolbar-title">Material Color Override</div>
        <div class="ar-color-swatches" id="ar-color-swatches"></div>
      </div>

      <!-- Bottom Control Bar & Catalog Carousel -->
      <div class="ar-bottom-panel">
        <div class="ar-catalog-header">
          <span>Catalog Items</span>
          <span class="ar-placed-count" id="ar-placed-count">0 items in room</span>
        </div>
        <div class="ar-catalog-carousel" id="ar-catalog-carousel"></div>

        <!-- Action Bridge Bar -->
        <div class="ar-action-bar">
          <button class="ar-order-bridge-btn" id="ar-order-bridge-btn">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <path d="M16 10a4 4 0 0 1-8 0"></path>
            </svg>
            <span>Order / Custom Request</span>
          </button>
        </div>
      </div>

      <!-- Toast Container -->
      <div class="ar-toast" id="ar-toast"></div>
    `;

    document.body.appendChild(this.container);

    this.hudBanner = this.container.querySelector("#ar-hud-banner");
    this.carouselEl = this.container.querySelector("#ar-catalog-carousel");
    this.colorToolbarEl = this.container.querySelector("#ar-color-swatches");
    this.deleteBtnEl = this.container.querySelector("#ar-delete-btn");
    this.toastEl = this.container.querySelector("#ar-toast");

    // Event Bindings
    this.container.querySelector("#ar-close-btn").addEventListener("click", () => this.destroy());
    this.deleteBtnEl.addEventListener("click", () => this.deleteSelectedObject());
    this.container.querySelector("#ar-order-bridge-btn").addEventListener("click", () => this.bridgeToCheckout());

    this.renderCatalogCarousel();
    this.renderColorSwatches();
    this.checkWebXRSupport();
  }

  showToast(message, type = "info") {
    if (!this.toastEl) return;
    this.toastEl.textContent = message;
    this.toastEl.className = `ar-toast active ${type}`;
    setTimeout(() => {
      this.toastEl.classList.remove("active");
    }, 3200);
  }

  setPhase(phase) {
    this.arPhase = phase;
    const hudText = this.hudBanner.querySelector("#ar-hud-text");
    if (phase === 1) {
      this.hudBanner.className = "ar-hud-banner phase-1";
      if (hudText) hudText.textContent = "MOVE PHONE TO SCAN FLOOR";
    } else {
      this.hudBanner.className = "ar-hud-banner phase-2";
      if (hudText) hudText.textContent = "TAP THE FLOOR TO PLACE ITEM";
    }
  }

  renderCatalogCarousel() {
    if (!this.carouselEl) return;
    this.carouselEl.innerHTML = "";

    const items = this.catalog.length > 0 ? this.catalog : [this.initialProduct].filter(Boolean);

    items.forEach((prod) => {
      if (!prod) return;
      const isSelected = this.selectedCatalogItem?.id === prod.id;
      const isPlaced = this.placedProductIds.has(prod.id);

      const itemCard = document.createElement("div");
      itemCard.className = `ar-catalog-item ${isSelected ? "selected" : ""} ${isPlaced ? "placed" : ""}`;
      itemCard.innerHTML = `
        <div class="ar-item-thumb-wrapper">
          <img src="${prod.image || prod.imageUrl || 'assets/product_sofa.png'}" alt="${prod.name}">
          ${isPlaced ? '<span class="ar-placed-badge">Placed</span>' : ""}
        </div>
        <div class="ar-item-info">
          <div class="ar-item-name">${prod.name || "Furniture"}</div>
          <div class="ar-item-price">${prod.price ? "$" + prod.price : ""}</div>
        </div>
      `;

      itemCard.addEventListener("click", () => {
        this.selectedCatalogItem = prod;
        this.renderCatalogCarousel();
        this.showToast(`Selected: ${prod.name}`);
      });

      this.carouselEl.appendChild(itemCard);
    });
  }

  renderColorSwatches() {
    if (!this.colorToolbarEl) return;
    this.colorToolbarEl.innerHTML = "";

    this.colorPalette.forEach((c) => {
      const swatch = document.createElement("button");
      swatch.className = `color-swatch ${this.activeColor.toLowerCase() === c.hex.toLowerCase() ? "active" : ""}`;
      swatch.style.backgroundColor = c.hex;
      swatch.title = c.name;
      swatch.addEventListener("click", () => {
        this.applyColorOverride(c.hex);
        this.renderColorSwatches();
      });
      this.colorToolbarEl.appendChild(swatch);
    });

    // Custom Color Picker input
    const customInput = document.createElement("input");
    customInput.type = "color";
    customInput.className = "custom-color-picker";
    customInput.value = this.activeColor;
    customInput.title = "Custom Tint Color";
    customInput.addEventListener("input", (e) => {
      this.applyColorOverride(e.target.value);
    });
    this.colorToolbarEl.appendChild(customInput);
  }

  applyColorOverride(hexColor) {
    this.activeColor = hexColor;

    if (!this.selectedPlacedObject) {
      this.showToast("Select a placed 3D item to tint its color.");
      return;
    }

    const colorObj = new THREE.Color(hexColor);
    // Emissive factor multiplication so dark/black models tint clearly
    const emissiveObj = new THREE.Color(hexColor).multiplyScalar(0.25);

    this.selectedPlacedObject.modelMesh.traverse((child) => {
      if (child.isMesh && child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((mat) => this.tintMaterial(mat, colorObj, emissiveObj));
        } else {
          this.tintMaterial(child.material, colorObj, emissiveObj);
        }
      }
    });

    this.selectedPlacedObject.color = hexColor;
    this.showToast(`Applied material color: ${hexColor}`);
  }

  tintMaterial(material, colorObj, emissiveObj) {
    // Modify baseColorFactor (diffuse)
    material.color.copy(colorObj);
    // Modify emissiveFactor so dark models reflect tint clearly
    if (material.emissive) {
      material.emissive.copy(emissiveObj);
    }
    material.needsUpdate = true;
  }

  initThreeJS() {
    const canvasWrapper = this.container.querySelector("#ar-canvas-container");

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 20);
    this.camera.position.set(0, 1.2, 2.5);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.xr.enabled = true;

    canvasWrapper.appendChild(this.renderer.domElement);

    // Orbit Controls for non-XR fallback mode
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02; // Prevent camera going under floor
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 6;
    this.controls.target.set(0, 0, 0);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(2, 4, 2);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.bias = -0.0001;
    this.scene.add(dirLight);

    // Grid Floor Plane for Web preview
    const floorGeo = new THREE.PlaneGeometry(10, 10);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.ShadowMaterial({ opacity: 0.3 });
    this.floorPlane = new THREE.Mesh(floorGeo, floorMat);
    this.floorPlane.receiveShadow = true;
    this.scene.add(this.floorPlane);

    // Event Listeners for Interaction
    window.addEventListener("resize", this.onWindowResize.bind(this));
    this.renderer.domElement.addEventListener("pointerdown", this.onPointerDown.bind(this));
    this.renderer.domElement.addEventListener("pointermove", this.onPointerMove.bind(this));
    this.renderer.domElement.addEventListener("pointerup", this.onPointerUp.bind(this));
  }

  setupReticle() {
    // Reticle Group
    this.reticle = new THREE.Group();

    // 0.8m Radius Semi-Transparent White Outline Ring
    const ringGeo = new THREE.RingGeometry(0.78, 0.80, 64);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });
    this.reticleRing = new THREE.Mesh(ringGeo, ringMat);
    this.reticle.add(this.reticleRing);

    // Subtle inner placement target dot
    const dotGeo = new THREE.CircleGeometry(0.04, 32);
    dotGeo.rotateX(-Math.PI / 2);
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
    const dot = new THREE.Mesh(dotGeo, dotMat);
    this.reticle.add(dot);

    this.reticle.visible = false;
    this.scene.add(this.reticle);
  }

  checkWebXRSupport() {
    if ("xr" in navigator) {
      navigator.xr.isSessionSupported("immersive-ar").then((supported) => {
        if (supported) {
          const webxrBtn = this.container.querySelector("#ar-webxr-launch-btn");
          if (webxrBtn) {
            webxrBtn.style.display = "flex";
            webxrBtn.addEventListener("click", () => this.onStartWebXRSession());
          }
        }
      });
    }
  }

  async onStartWebXRSession() {
    try {
      const session = await navigator.xr.requestSession("immersive-ar", {
        requiredFeatures: ["hit-test"],
        optionalFeatures: ["dom-overlay"],
        domOverlay: { root: this.container },
      });

      this.xrSession = session;
      this.renderer.xr.setReferenceSpaceType("local");
      await this.renderer.xr.setSession(session);

      session.addEventListener("end", () => {
        this.xrSession = null;
        this.hitTestSourceRequested = false;
        this.hitTestSource = null;
      });

      session.addEventListener("select", () => {
        if (this.reticle.visible && this.selectedCatalogItem) {
          this.placeActiveFurniture(this.reticle.position.clone());
        }
      });
    } catch (err) {
      console.warn("Failed to launch WebXR session:", err);
      this.showToast("Could not start WebXR Immersive AR mode.", "error");
    }
  }

  onWindowResize() {
    if (!this.camera || !this.renderer) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  onPointerDown(e) {
    if (this.xrSession) return; // Handled by WebXR select event

    this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Check if user clicked an existing placed model
    const placedMeshes = this.placedObjects.map((o) => o.modelMesh);
    const intersects = this.raycaster.intersectObjects(placedMeshes, true);

    if (intersects.length > 0) {
      // Find top object container
      let hitMesh = intersects[0].object;
      while (hitMesh.parent && hitMesh.parent !== this.scene) {
        hitMesh = hitMesh.parent;
      }

      const objRecord = this.placedObjects.find((o) => o.modelMesh === hitMesh);
      if (objRecord) {
        this.selectPlacedObject(objRecord);
        this.isDragging = true;
        this.draggedObject = objRecord;
        this.startLiftPhysics(objRecord);
        return;
      }
    }

    // Deselect if clicked elsewhere
    this.deselectObject();

    // Check hit on floor plane to place item
    const floorHits = this.raycaster.intersectObject(this.floorPlane);
    if (floorHits.length > 0) {
      const hitPoint = floorHits[0].point;
      this.placeActiveFurniture(hitPoint);
    }
  }

  onPointerMove(e) {
    this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Update Drag Repositioning if active
    if (this.isDragging && this.draggedObject) {
      const hits = this.raycaster.intersectObject(this.floorPlane);
      if (hits.length > 0) {
        const hitPoint = hits[0].point;
        this.draggedObject.modelMesh.position.x = hitPoint.x;
        this.draggedObject.modelMesh.position.z = hitPoint.z;
        if (this.draggedObject.shadowMesh) {
          this.draggedObject.shadowMesh.position.x = hitPoint.x;
          this.draggedObject.shadowMesh.position.z = hitPoint.z;
        }
        this.reticle.position.set(hitPoint.x, 0.001, hitPoint.z);
      }
      return;
    }

    // Update Non-XR Reticle Position
    if (!this.xrSession) {
      const floorHits = this.raycaster.intersectObject(this.floorPlane);
      if (floorHits.length > 0) {
        const pt = floorHits[0].point;
        this.reticle.position.set(pt.x, 0.001, pt.z);
        this.reticle.visible = true;

        if (this.arPhase === 1) {
          this.planeDetected = true;
          this.setPhase(2);
        }
      }
    }

    // Update Floating Delete Button 2D Screen Position
    if (this.selectedPlacedObject && this.deleteBtnEl) {
      this.updateDeleteBtnPosition();
    }
  }

  onPointerUp() {
    if (this.isDragging && this.draggedObject) {
      this.releaseDropPhysics(this.draggedObject);
      this.isDragging = false;
      this.draggedObject = null;
    }
  }

  // --- Single-Piece Rule & Placement Flow ---
  async placeActiveFurniture(position) {
    if (!this.selectedCatalogItem) {
      this.showToast("Please select a catalog product first.");
      return;
    }

    const prodId = this.selectedCatalogItem.id;

    // Single-Piece Rule: Prevent duplicate spawns of exact same product ID
    if (this.placedProductIds.has(prodId)) {
      this.showToast(`Single-Piece Rule: '${this.selectedCatalogItem.name}' is already placed in the room.`, "warning");
      return;
    }

    // Create 3D Model Instance
    this.showToast(`Loading 3D model for ${this.selectedCatalogItem.name}...`);
    const modelUrl = this.selectedCatalogItem.modelUrl || this.selectedCatalogItem.glbUrl || "/assets/models/sofa.glb";

    try {
      const gltf = await this.loadGLTFModel(modelUrl);
      const modelMesh = gltf.scene;

      // Calculate scale & bounding box grounding
      const box = new THREE.Box3().setFromObject(modelMesh);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const targetSize = 1.2; // ~1.2 meter standard size
      const scale = maxDim > 0 ? targetSize / maxDim : 1;
      modelMesh.scale.set(scale, scale, scale);

      // Re-calculate box to ground bottom at Y = 0
      box.setFromObject(modelMesh);
      const minY = box.min.y;
      modelMesh.position.set(position.x, position.y - minY, position.z);

      // Shadow Plane under furniture
      const shadowGeo = new THREE.PlaneGeometry(1.4, 1.4);
      shadowGeo.rotateX(-Math.PI / 2);
      const shadowMat = new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      });
      const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
      shadowMesh.position.set(position.x, 0.002, position.z);
      this.scene.add(shadowMesh);

      // Enable casting/receiving shadows on mesh
      modelMesh.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });

      this.scene.add(modelMesh);

      const objRecord = {
        id: "item_" + Date.now(),
        productId: prodId,
        name: this.selectedCatalogItem.name,
        modelMesh: modelMesh,
        shadowMesh: shadowMesh,
        color: "#ffffff",
        baseY: position.y - minY,
        currentY: position.y - minY,
        targetY: position.y - minY,
        isLifted: false,
        liftProgress: 0,
      };

      this.placedObjects.push(objRecord);
      this.placedProductIds.add(prodId);

      this.selectPlacedObject(objRecord);
      this.renderCatalogCarousel();
      this.updatePlacedCount();
      this.showToast(`Placed ${this.selectedCatalogItem.name} into room.`);
    } catch (err) {
      console.warn("Failed to load GLTF model:", err);
      // Create procedural fallback 3D sofa shape if model fails
      this.spawnFallbackShape(position, prodId);
    }
  }

  spawnFallbackShape(position, prodId) {
    const group = new THREE.Group();
    const baseGeo = new THREE.BoxGeometry(1.2, 0.4, 0.8);
    const backGeo = new THREE.BoxGeometry(1.2, 0.6, 0.2);

    const mat = new THREE.MeshStandardMaterial({ color: 0xc49a6c, roughness: 0.4 });

    const base = new THREE.Mesh(baseGeo, mat);
    base.position.y = 0.2;
    base.castShadow = true;
    group.add(base);

    const back = new THREE.Mesh(backGeo, mat);
    back.position.set(0, 0.5, -0.3);
    back.castShadow = true;
    group.add(back);

    group.position.set(position.x, position.y, position.z);
    this.scene.add(group);

    const shadowGeo = new THREE.PlaneGeometry(1.4, 1.4);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 });
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.position.set(position.x, 0.002, position.z);
    this.scene.add(shadowMesh);

    const objRecord = {
      id: "item_" + Date.now(),
      productId: prodId,
      name: this.selectedCatalogItem?.name || "Furniture",
      modelMesh: group,
      shadowMesh: shadowMesh,
      color: "#c49a6c",
      baseY: position.y,
      currentY: position.y,
      targetY: position.y,
      isLifted: false,
      liftProgress: 0,
    };

    this.placedObjects.push(objRecord);
    this.placedProductIds.add(prodId);

    this.selectPlacedObject(objRecord);
    this.renderCatalogCarousel();
    this.updatePlacedCount();
    this.showToast(`Placed 3D preview of ${this.selectedCatalogItem?.name || 'Furniture'}.`);
  }

  loadGLTFModel(url) {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => resolve(gltf),
        undefined,
        (err) => reject(err)
      );
    });
  }

  // --- Dynamic Lift & Drop Physics (0.25m) & Shadow Logic ---
  startLiftPhysics(objRecord) {
    if (!objRecord) return;
    objRecord.isLifted = true;
    objRecord.targetY = objRecord.baseY + 0.25; // Smooth 0.25m vertical lift

    // Shadow Logic: Turn off soft floor shadow while lifted
    if (objRecord.shadowMesh) {
      objRecord.shadowMesh.visible = false;
    }
  }

  releaseDropPhysics(objRecord) {
    if (!objRecord) return;
    objRecord.isLifted = false;
    objRecord.targetY = objRecord.baseY; // Smooth drop to floor plane
  }

  updatePhysics(delta) {
    const lerpSpeed = 10 * delta; // Smooth 60fps easing

    this.placedObjects.forEach((obj) => {
      // Interpolate Y position towards targetY
      obj.currentY += (obj.targetY - obj.currentY) * Math.min(lerpSpeed, 1);
      obj.modelMesh.position.y = obj.currentY;

      // Check if dropped back to ground (within 0.005m tolerance)
      if (!obj.isLifted && Math.abs(obj.currentY - obj.baseY) < 0.005) {
        obj.currentY = obj.baseY;
        obj.modelMesh.position.y = obj.baseY;

        // Shadow Logic: Re-enable soft floor shadow only when grounded!
        if (obj.shadowMesh) {
          obj.shadowMesh.visible = true;
        }
      }
    });
  }

  // --- Selection & Individual Delete ---
  selectPlacedObject(objRecord) {
    this.selectedPlacedObject = objRecord;

    // Pin 0.8m White Ring Ground Guide beneath active furniture
    this.reticle.position.set(objRecord.modelMesh.position.x, 0.001, objRecord.modelMesh.position.z);
    this.reticle.visible = true;

    if (this.deleteBtnEl) {
      this.deleteBtnEl.style.display = "flex";
      this.updateDeleteBtnPosition();
    }

    if (objRecord.color) {
      this.activeColor = objRecord.color;
      this.renderColorSwatches();
    }
  }

  deselectObject() {
    this.selectedPlacedObject = null;
    if (this.deleteBtnEl) {
      this.deleteBtnEl.style.display = "none";
    }
  }

  deleteSelectedObject() {
    if (!this.selectedPlacedObject) return;

    const obj = this.selectedPlacedObject;
    this.scene.remove(obj.modelMesh);
    if (obj.shadowMesh) this.scene.remove(obj.shadowMesh);

    this.placedObjects = this.placedObjects.filter((o) => o.id !== obj.id);
    this.placedProductIds.delete(obj.productId);

    this.deselectObject();
    this.renderCatalogCarousel();
    this.updatePlacedCount();
    this.showToast(`Deleted ${obj.name} from scene.`);
  }

  updateDeleteBtnPosition() {
    if (!this.selectedPlacedObject || !this.deleteBtnEl || !this.camera) return;

    const pos = this.selectedPlacedObject.modelMesh.position.clone();
    pos.y += 0.8; // Position floating delete button above model

    pos.project(this.camera);

    const x = (pos.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-pos.y * 0.5 + 0.5) * window.innerHeight;

    this.deleteBtnEl.style.left = `${Math.max(20, Math.min(window.innerWidth - 120, x - 50))}px`;
    this.deleteBtnEl.style.top = `${Math.max(60, Math.min(window.innerHeight - 180, y - 20))}px`;
  }

  updatePlacedCount() {
    const el = this.container.querySelector("#ar-placed-count");
    if (el) {
      el.textContent = `${this.placedObjects.length} item${this.placedObjects.length === 1 ? "" : "s"} in room`;
    }
  }

  // --- App Store / Checkout Bridge ---
  bridgeToCheckout() {
    if (this.placedObjects.length === 0 && !this.selectedCatalogItem) {
      this.showToast("No items selected or placed to create order request.", "warning");
      return;
    }

    // Render snapshot PNG
    this.renderer.render(this.scene, this.camera);
    let snapshotDataUrl = "";
    try {
      snapshotDataUrl = this.renderer.domElement.toDataURL("image/png");
    } catch (e) {
      console.warn("Snapshot capture warning:", e);
    }

    const orderPayload = {
      timestamp: new Date().toISOString(),
      items: this.placedObjects.map((o) => ({
        id: o.productId,
        name: o.name,
        color: o.color,
      })),
      selectedItem: this.selectedCatalogItem
        ? {
            id: this.selectedCatalogItem.id,
            name: this.selectedCatalogItem.name,
            color: this.activeColor,
          }
        : null,
      snapshot: snapshotDataUrl,
    };

    localStorage.setItem("lanica_custom_ar_order", JSON.stringify(orderPayload));
    this.showToast("Saved custom AR configuration! Redirecting to orders...", "info");

    setTimeout(() => {
      window.location.href = "orders.html?ar_custom=true";
    }, 1200);
  }

  // --- WebXR Hit Test & Main Loop ---
  animate(timestamp, frame) {
    if (this.renderer.xr.isPresenting) {
      this.updateWebXRHitTest(frame);
    } else if (this.controls) {
      this.controls.update();
    }

    // 60fps Lift & Drop Physics update
    this.updatePhysics(0.016);

    // Render 3D Scene
    this.renderer.render(this.scene, this.camera);

    this.renderer.setAnimationLoop(this.animate.bind(this));
  }

  updateWebXRHitTest(frame) {
    if (!frame) return;
    const session = this.renderer.xr.getSession();

    if (!this.hitTestSourceRequested) {
      session.requestReferenceSpace("viewer").then((refSpace) => {
        session.requestHitTestSource({ space: refSpace }).then((source) => {
          this.hitTestSource = source;
        });
      });
      session.addEventListener("end", () => {
        this.hitTestSourceRequested = false;
        this.hitTestSource = null;
      });
      this.hitTestSourceRequested = true;
    }

    if (this.hitTestSource) {
      const hitTestResults = frame.getHitTestResults(this.hitTestSource);
      if (hitTestResults.length > 0) {
        const hit = hitTestResults[0];
        const referenceSpace = this.renderer.xr.getReferenceSpace();
        const hitPose = hit.getPose(referenceSpace);

        if (hitPose) {
          this.reticle.visible = true;
          this.reticle.position.set(hitPose.transform.position.x, hitPose.transform.position.y, hitPose.transform.position.z);
          this.reticle.updateMatrixWorld(true);

          if (this.arPhase === 1) {
            this.setPhase(2);
          }
        }
      } else {
        this.reticle.visible = false;
        if (this.arPhase === 2 && this.placedObjects.length === 0) {
          this.setPhase(1);
        }
      }
    }
  }

  destroy() {
    if (this.xrSession) {
      this.xrSession.end();
    }
    if (this.container) {
      this.container.remove();
    }
    if (this.onClose) {
      this.onClose();
    }
  }
}
