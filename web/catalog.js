const renderTrace = (listId, header) => {
  const list = document.getElementById(listId);
  list.replaceChildren();
  const steps = header?.split(" -> ").filter(Boolean) ?? [];
  if (steps.length === 0) {
    const item = document.createElement("li");
    item.textContent = "Trace not available";
    list.appendChild(item);
    return;
  }

  for (const step of steps) {
    const item = document.createElement("li");
    item.textContent = step;
    list.appendChild(item);
  }
};

const loadProducts = async () => {
  const status = document.getElementById("status");
  try {
    const response = await fetch("/api/products/cheapest");
    renderTrace("products-trace", response.headers.get("X-Request-Trace"));
    if (!response.ok) throw new Error("The catalog API is unavailable.");
    const products = await response.json();
    status.textContent = "";
    const list = document.getElementById("products");
    for (const product of products) {
      const item = document.createElement("li");
      item.textContent = `${product.name} — $${Number(product.price).toFixed(2)}`;
      list.appendChild(item);
    }
  } catch (error) {
    status.textContent = error.message;
  }
};

const loadReviews = async () => {
  const status = document.getElementById("reviews-status");
  try {
    const response = await fetch("/api/products/ST-001/reviews");
    renderTrace("reviews-trace", response.headers.get("X-Request-Trace"));
    if (!response.ok) throw new Error("The reviews API is unavailable.");
    const { reviews } = await response.json();
    status.textContent = reviews.length === 0 ? "No reviews yet." : "";
    const list = document.getElementById("reviews");
    for (const review of reviews) {
      const item = document.createElement("li");
      item.textContent = `${review.reviewer} — ${review.rating}/5: ${review.comment}`;
      list.appendChild(item);
    }
  } catch (error) {
    status.textContent = error.message;
  }
};

const queryEndpoint = async (path, method = "GET") => {
  const status = document.getElementById("api-result-status");
  const result = document.getElementById("api-result");
  status.textContent = "Request in progress...";
  result.textContent = "";
  try {
    const response = await fetch(`/api${path}`, { method });
    renderTrace("api-trace", response.headers.get("X-Request-Trace"));
    const payload = await response.json();
    result.textContent = JSON.stringify(payload, null, 2);
    status.textContent = `${method} ${path} — HTTP ${response.status}`;
  } catch (error) {
    renderTrace("api-trace", null);
    status.textContent = error.message;
  }
};

document.getElementById("query-api").addEventListener("click", () => {
  void queryEndpoint(document.getElementById("api-endpoint").value);
});

document.getElementById("clear-cache").addEventListener("click", () => {
  void queryEndpoint("/cache/clear", "POST");
});

void Promise.all([loadProducts(), loadReviews()]);
