/**
 * Lanica Furniture Platform - Central Reusable Pagination Engine
 * Enterprise Tabular Data Pagination & Skeleton Loading Architecture
 */

/**
 * Generates smart page numbers with ellipses.
 * Example: 1 ... 12 13 14 ... 95
 */
export function generateSmartPageNumbers(currentPage, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, "...", totalPages];
  }
  if (currentPage >= totalPages - 3) {
    return [1, "...", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }
  return [1, "...", currentPage - 1, currentPage, currentPage + 1, "...", totalPages];
}

/**
 * Updates URL search parameter without full page reload.
 */
export function updateURLQueryParam(key, value) {
  if (!key) return;
  const url = new URL(window.location.href);
  if (value !== null && value !== undefined && value !== "") {
    url.searchParams.set(key, value);
  } else {
    url.searchParams.delete(key);
  }
  window.history.replaceState({}, "", url.toString());
}

/**
 * Retrieves URL search parameter value with optional numeric fallback.
 */
export function getURLQueryParam(key, defaultVal = 1) {
  const params = new URLSearchParams(window.location.search);
  const val = params.get(key);
  if (val === null || val === undefined) return defaultVal;
  const num = parseInt(val, 10);
  return isNaN(num) ? val : num;
}

/**
 * Renders a standardized, enterprise-grade pagination footer inside target container.
 */
export function renderPagination({
  container,
  currentPage = 1,
  totalPages = 1,
  totalItems = 0,
  pageSize = 10,
  pageSizeOptions = [10, 25, 50, 100],
  urlParamPrefix = "",
  onPageChange,
  onPageSizeChange,
  onJumpToPage,
}) {
  if (!container) return;

  let footer = container.querySelector(".table-pagination-footer");
  if (!footer) {
    footer = document.createElement("div");
    footer.className = "table-pagination-footer";
    container.appendChild(footer);
  }

  // Update URL search parameters if prefix provided
  if (urlParamPrefix) {
    updateURLQueryParam(`${urlParamPrefix}Page`, currentPage);
    updateURLQueryParam(`${urlParamPrefix}Limit`, pageSize);
  }

  const startIndex = (currentPage - 1) * pageSize;
  const startItem = totalItems > 0 ? startIndex + 1 : 0;
  const endItem = Math.min(startIndex + pageSize, totalItems);
  const pageNumbers = generateSmartPageNumbers(currentPage, totalPages);

  const pageBtnsHtml = pageNumbers
    .map((p) => {
      if (p === "...") return `<span class="pagination-ellipsis">…</span>`;
      return `<button type="button" class="pagination-num-btn ${p === currentPage ? "active" : ""}" data-page="${p}">${p}</button>`;
    })
    .join("");

  const perPageOptionsHtml = pageSizeOptions
    .map((size) => `<option value="${size}" ${pageSize === size ? "selected" : ""}>${size}</option>`)
    .join("");

  const jumpHtml =
    totalPages >= 5
      ? `
        <div class="pagination-jump">
          <span>Go to:</span>
          <input type="number" class="pagination-jump-input" min="1" max="${totalPages}" placeholder="#" aria-label="Jump to page" />
          <button type="button" class="pagination-jump-btn">Go</button>
        </div>
      `
      : "";

  footer.innerHTML = `
    <div class="pagination-info">
      Showing <strong>${startItem}–${endItem}</strong> of <strong>${totalItems}</strong> entries
    </div>
    <div class="pagination-controls">
      <div class="pagination-per-page">
        <label>Per page:</label>
        <select class="pagination-select">${perPageOptionsHtml}</select>
      </div>
      <div class="pagination-buttons">
        <button type="button" class="pagination-btn first-btn" ${currentPage <= 1 ? "disabled" : ""} title="First Page" aria-label="First Page">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="11 17 6 12 11 7"></polyline><polyline points="18 17 13 12 18 7"></polyline></svg>
        </button>
        <button type="button" class="pagination-btn prev-btn" ${currentPage <= 1 ? "disabled" : ""} title="Previous Page" aria-label="Previous Page">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
        <div class="pagination-pages-list">${pageBtnsHtml}</div>
        <button type="button" class="pagination-btn next-btn" ${currentPage >= totalPages ? "disabled" : ""} title="Next Page" aria-label="Next Page">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>
        <button type="button" class="pagination-btn last-btn" ${currentPage >= totalPages ? "disabled" : ""} title="Last Page" aria-label="Last Page">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="13 17 18 12 13 7"></polyline><polyline points="6 17 11 12 6 7"></polyline></svg>
        </button>
      </div>
      ${jumpHtml}
    </div>
  `;

  // Bind Per Page Selector
  const perPageSelect = footer.querySelector(".pagination-select");
  if (perPageSelect) {
    perPageSelect.addEventListener("change", (e) => {
      const newSize = parseInt(e.target.value, 10) || pageSize;
      if (onPageSizeChange) onPageSizeChange(newSize);
    });
  }

  // Bind Direct Page Number Clicks
  footer.querySelectorAll(".pagination-num-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetPage = parseInt(btn.getAttribute("data-page"), 10);
      if (targetPage && targetPage !== currentPage && onPageChange) {
        onPageChange(targetPage);
      }
    });
  });

  // Bind First, Prev, Next, Last Buttons
  const firstBtn = footer.querySelector(".first-btn");
  const prevBtn = footer.querySelector(".prev-btn");
  const nextBtn = footer.querySelector(".next-btn");
  const lastBtn = footer.querySelector(".last-btn");

  if (firstBtn) firstBtn.addEventListener("click", () => currentPage > 1 && onPageChange && onPageChange(1));
  if (prevBtn) prevBtn.addEventListener("click", () => currentPage > 1 && onPageChange && onPageChange(currentPage - 1));
  if (nextBtn) nextBtn.addEventListener("click", () => currentPage < totalPages && onPageChange && onPageChange(currentPage + 1));
  if (lastBtn) lastBtn.addEventListener("click", () => currentPage < totalPages && onPageChange && onPageChange(totalPages));

  // Bind Jump to Page Input
  const jumpInput = footer.querySelector(".pagination-jump-input");
  const jumpBtn = footer.querySelector(".pagination-jump-btn");
  const triggerJump = () => {
    if (!jumpInput) return;
    let target = parseInt(jumpInput.value, 10);
    if (!isNaN(target)) {
      if (target < 1) target = 1;
      if (target > totalPages) target = totalPages;
      if (target !== currentPage) {
        if (onJumpToPage) onJumpToPage(target);
        else if (onPageChange) onPageChange(target);
      }
    }
  };

  if (jumpBtn) jumpBtn.addEventListener("click", triggerJump);
  if (jumpInput) {
    jumpInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        triggerJump();
      }
    });
  }
}

/**
 * Renders skeleton shimmer loading rows inside a table body during page transitions.
 */
export function showTableSkeleton(tableBodyEl, colCount = 5, rowCount = 5) {
  if (!tableBodyEl) return;
  let rowsHtml = "";
  for (let r = 0; r < rowCount; r++) {
    let cellsHtml = "";
    for (let c = 0; c < colCount; c++) {
      const widthPercent = Math.floor(Math.random() * 40) + 50; // 50% - 90%
      cellsHtml += `<td><div class="skeleton-cell" style="width: ${widthPercent}%;"></div></td>`;
    }
    rowsHtml += `<tr>${cellsHtml}</tr>`;
  }
  tableBodyEl.innerHTML = rowsHtml;
}

/**
 * Renders a standardized empty state row inside a table body.
 */
export function renderTableEmptyState(tableBodyEl, colCount = 5, message = "No records found.", icon = "📦") {
  if (!tableBodyEl) return;
  tableBodyEl.innerHTML = `
    <tr>
      <td colspan="${colCount}" style="text-align: center; padding: 48px 24px; color: #64748b;">
        <div style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
          <span style="font-size: 2rem;">${icon}</span>
          <p style="margin: 0; font-size: 0.925rem; font-weight: 500; color: #475569;">${message}</p>
        </div>
      </td>
    </tr>
  `;
}
