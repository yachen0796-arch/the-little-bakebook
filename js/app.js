/* =====================================================
   THE LITTLE BAKEBOOK
   Main application
   Compatible with the existing Supabase database.
===================================================== */

const CONFIG = window.BAKEBOOK_CONFIG;

if (!CONFIG || !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
  throw new Error("Please configure your Supabase URL and publishable key in js/config.js");
}

if (!window.supabase) {
  throw new Error("Supabase client library did not load.");
}

const supabaseClient = window.supabase.createClient(
  CONFIG.SUPABASE_URL,
  CONFIG.SUPABASE_ANON_KEY
);

const BUCKET = "baking-photos";

let currentUser = null;
let recipes = [];
let reviews = [];
let photos = [];
let currentRecipe = null;
let isSigningUp = false;

// -----------------------------------------------------
// Helpers
// -----------------------------------------------------

const $ = (id) => document.getElementById(id);

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function showMessage(message, type = "") {
  const element = $("app-message");
  element.textContent = message;
  element.className = "status-message " + type;
}

function showAuthMessage(message, type = "") {
  const element = $("auth-message");
  element.textContent = message;
  element.className = "status-message " + type;
}

function formatDate(date) {
  if (!date) return "Date not recorded";

  const parsedDate = new Date(date + "T00:00:00");
  if (Number.isNaN(parsedDate.getTime())) return "Date not recorded";

  return parsedDate.toLocaleDateString(
    "en-AU",
    { day: "numeric", month: "short", year: "numeric" }
  );
}

function getReview(recipeId) {
  return reviews.find(review => String(review.recipe_id) === String(recipeId));
}

function getRecipePhotos(recipeId) {
  return photos.filter(photo => String(photo.recipe_id) === String(recipeId));
}

function setButtonLoading(button, loading, text = "Saving...") {
  if (!button) return;

  if (loading) {
    if (!button.disabled) button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.textContent = text;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalText || "Save";
    delete button.dataset.originalText;
  }
}

function showEmpty(message) {
  return `
    <div class="empty-state">
      <div class="flower" aria-hidden="true">✿</div>
      <h3>Nothing here yet</h3>
      <p>${escapeHTML(message)}</p>
    </div>
  `;
}

// -----------------------------------------------------
// Authentication
// -----------------------------------------------------

$("auth-toggle").addEventListener("click", () => {
  isSigningUp = !isSigningUp;

  $("auth-submit").textContent = isSigningUp ? "Create account" : "Sign in";
  $("auth-password").autocomplete = isSigningUp ? "new-password" : "current-password";
  $("auth-toggle").textContent = isSigningUp
    ? "Already have an account? Sign in"
    : "Don't have an account? Sign up";

  showAuthMessage("");
});

$("auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  const button = $("auth-submit");

  setButtonLoading(button, true, "Please wait...");

  try {
    let result;

    if (isSigningUp) {
      result = await supabaseClient.auth.signUp({ email, password });
    } else {
      result = await supabaseClient.auth.signInWithPassword({ email, password });
    }

    if (result.error) throw result.error;

    if (isSigningUp && !result.data.session) {
      showAuthMessage(
        "Account created. Please check your email if confirmation is required.",
        "success"
      );
    } else {
      showAuthMessage("Signed in successfully.", "success");
    }
  } catch (error) {
    showAuthMessage(error.message || "Authentication failed.", "error");
  } finally {
    setButtonLoading(button, false);
  }
});

$("sign-out").addEventListener("click", async () => {
  const { error } = await supabaseClient.auth.signOut();

  if (error) showMessage(error.message, "error");
});

// -----------------------------------------------------
// App startup and authentication state
// -----------------------------------------------------

async function enterApp() {
  $("auth-screen").classList.add("hidden");
  $("app").classList.remove("hidden");
  await loadAllData();
}

async function initialise() {
  const { data, error } = await supabaseClient.auth.getSession();

  if (error) {
    showAuthMessage(error.message, "error");
    return;
  }

  if (data.session) {
    currentUser = data.session.user;
    await enterApp();
  }

  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    if (session) {
      currentUser = session.user;
      await enterApp();
    } else {
      currentUser = null;
      currentRecipe = null;
      recipes = [];
      reviews = [];
      photos = [];
      $("app").classList.add("hidden");
      $("auth-screen").classList.remove("hidden");
    }
  });
}

// -----------------------------------------------------
// Load existing database records
// -----------------------------------------------------

async function loadAllData() {
  if (!currentUser) return;

  showMessage("Loading your baking journal...");

  try {
    const [recipeResult, reviewResult, photoResult] = await Promise.all([
      supabaseClient
        .from("recipes")
        .select("*")
        .order("baked_on", { ascending: false, nullsFirst: false }),
      supabaseClient.from("reviews").select("*"),
      supabaseClient.from("photos").select("*")
    ]);

    if (recipeResult.error) throw recipeResult.error;
    if (reviewResult.error) throw reviewResult.error;
    if (photoResult.error) throw photoResult.error;

    recipes = recipeResult.data || [];
    reviews = reviewResult.data || [];
    photos = photoResult.data || [];

    renderDashboard();
    renderRecipes();
    renderTimeline();
    showMessage("");
  } catch (error) {
    showMessage("Could not load your records: " + error.message, "error");
  }
}

// -----------------------------------------------------
// Navigation
// -----------------------------------------------------

const pageNames = {
  dashboard: ["YOUR LITTLE BAKING CORNER", "Welcome back!"],
  recipes: ["ALL YOUR CREATIONS", "My recipes"],
  timeline: ["YOUR BAKING JOURNEY", "Baking timeline"],
  backup: ["KEEP YOUR MEMORIES SAFE", "Backup & data"]
};

function showPage(page) {
  if (!pageNames[page]) return;

  document.querySelectorAll(".page").forEach(section => {
    section.classList.add("hidden");
  });

  const target = $(page + "-page");
  if (target) target.classList.remove("hidden");

  document.querySelectorAll(".nav-item").forEach(button => {
    button.classList.toggle("active", button.dataset.page === page);
  });

  $("page-eyebrow").textContent = pageNames[page][0];
  $("page-title").textContent = pageNames[page][1];
}

document.querySelectorAll(".nav-item").forEach(button => {
  button.addEventListener("click", () => showPage(button.dataset.page));
});

document.querySelectorAll("[data-goto]").forEach(button => {
  button.addEventListener("click", () => showPage(button.dataset.goto));
});

// -----------------------------------------------------
// Dashboard
// -----------------------------------------------------

function renderDashboard() {
  $("stat-recipes").textContent = recipes.length;

  const now = new Date();
  const monthCount = recipes.filter(recipe => {
    if (!recipe.baked_on) return false;
    const date = new Date(recipe.baked_on + "T00:00:00");
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  }).length;

  $("stat-month").textContent = monthCount;
  $("stat-reviews").textContent = reviews.length;

  const recent = [...recipes]
    .sort((a, b) => (b.baked_on || "").localeCompare(a.baked_on || ""))
    .slice(0, 3);

  renderRecipeCards($("recent-recipes"), recent);
}

// -----------------------------------------------------
// Recipe cards and search
// -----------------------------------------------------

function renderRecipeCards(container, list) {
  if (!list.length) {
    container.innerHTML = showEmpty("Add your first bake to start your collection.");
    return;
  }

  container.innerHTML = list.map(recipe => {
    const category = escapeHTML(recipe.category || "Other");
    const name = escapeHTML(recipe.name || "Untitled recipe");
    const review = getReview(recipe.id);
    const photoCount = getRecipePhotos(recipe.id).length;

    return `
      <article class="recipe-card">
        <div class="recipe-cover" aria-hidden="true">${photoCount ? "📷" : "✿"}</div>
        <div class="recipe-card-content">
          <span class="category-tag">${category}</span>
          <h3>${name}</h3>
          <p class="recipe-meta">
            ${formatDate(recipe.baked_on)} · ${escapeHTML(recipe.difficulty || "Easy")}
          </p>
          <p class="recipe-meta">
            ${photoCount} photo${photoCount === 1 ? "" : "s"}
            ${review ? " · ★ " + escapeHTML(review.rating) + "/5" : ""}
          </p>
          <div class="card-actions">
            <button class="text-button" data-open-recipe="${escapeHTML(recipe.id)}" type="button">
              View recipe →
            </button>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

function renderRecipes() {
  const search = $("recipe-search").value.toLowerCase().trim();
  const category = $("category-filter").value;

  const filtered = recipes.filter(recipe => {
    const matchesSearch = (recipe.name || "").toLowerCase().includes(search);
    const matchesCategory = !category || recipe.category === category;
    return matchesSearch && matchesCategory;
  });

  renderRecipeCards($("all-recipes"), filtered);
}

$("recipe-search").addEventListener("input", renderRecipes);
$("category-filter").addEventListener("change", renderRecipes);

// -----------------------------------------------------
// Timeline
// -----------------------------------------------------

function renderTimeline() {
  const timeline = $("timeline-list");
  const sorted = [...recipes].sort((a, b) => (b.baked_on || "").localeCompare(a.baked_on || ""));

  if (!sorted.length) {
    timeline.innerHTML = showEmpty("Your baking journey will appear here.");
    return;
  }

  timeline.innerHTML = sorted.map(recipe => `
    <article class="timeline-item">
      <div class="timeline-date">${escapeHTML(formatDate(recipe.baked_on))}</div>
      <div>
        <h3>${escapeHTML(recipe.name || "Untitled recipe")}</h3>
        <p class="recipe-meta">${escapeHTML(recipe.category || "Other")} · ${escapeHTML(recipe.difficulty || "Easy")}</p>
        <button class="text-button" data-open-recipe="${escapeHTML(recipe.id)}" type="button">View recipe →</button>
      </div>
    </article>
  `).join("");
}

// -----------------------------------------------------
// Recipe modal and saving
// -----------------------------------------------------

function openRecipeForm(recipe = null) {
  $("recipe-form").reset();
  $("recipe-id").value = recipe?.id || "";
  $("recipe-modal-title").textContent = recipe ? "Edit your bake" : "Add a new bake";
  $("recipe-name").value = recipe?.name || "";
  $("recipe-category").value = recipe?.category || "Other";
  $("recipe-difficulty").value = recipe?.difficulty || "Easy";
  $("recipe-date").value = recipe?.baked_on || "";
  $("recipe-source").value = recipe?.source || "";
  $("recipe-ingredients").value = recipe?.ingredients || "";
  $("recipe-instructions").value = recipe?.instructions || "";
  $("recipe-modal").classList.remove("hidden");
  $("recipe-name").focus();
}

function closeRecipeForm() {
  $("recipe-modal").classList.add("hidden");
}

$("add-recipe").addEventListener("click", () => openRecipeForm());

document.querySelectorAll("[data-close-modal]").forEach(button => {
  button.addEventListener("click", closeRecipeForm);
});

$("recipe-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!currentUser) return;

  const id = $("recipe-id").value;
  const recipeData = {
    user_id: currentUser.id,
    name: $("recipe-name").value.trim(),
    category: $("recipe-category").value,
    difficulty: $("recipe-difficulty").value,
    baked_on: $("recipe-date").value || null,
    source: $("recipe-source").value.trim(),
    ingredients: $("recipe-ingredients").value.trim(),
    instructions: $("recipe-instructions").value.trim()
  };

  if (!recipeData.name) return;

  const button = $("save-recipe");
  setButtonLoading(button, true);

  try {
    let result;

    if (id) {
      result = await supabaseClient
        .from("recipes")
        .update(recipeData)
        .eq("id", id)
        .select()
        .single();
    } else {
      result = await supabaseClient
        .from("recipes")
        .insert(recipeData)
        .select()
        .single();
    }

    if (result.error) throw result.error;

    closeRecipeForm();
    await loadAllData();
    showMessage(id ? "Recipe updated!" : "Recipe saved!", "success");
  } catch (error) {
    showMessage("Could not save recipe: " + error.message, "error");
  } finally {
    setButtonLoading(button, false);
  }
});

// -----------------------------------------------------
// Recipe details
// -----------------------------------------------------

async function openRecipe(recipeId) {
  const recipe = recipes.find(item => String(item.id) === String(recipeId));
  if (!recipe) return;

  currentRecipe = recipe;
  const review = getReview(recipeId);
  const recipePhotos = getRecipePhotos(recipeId);

  const photoElements = await Promise.all(recipePhotos.map(async photo => {
    const { data, error } = await supabaseClient.storage
      .from(BUCKET)
      .createSignedUrl(photo.storage_path, 3600);

    if (error || !data?.signedUrl) {
      return `<div><p class="recipe-meta">Photo unavailable.</p></div>`;
    }

    return `
      <div>
        <img src="${escapeHTML(data.signedUrl)}" alt="${escapeHTML(photo.caption || recipe.name || "Baking photo")}">
        <button class="text-button" data-delete-photo="${escapeHTML(photo.id)}" type="button">Remove photo</button>
        <p class="recipe-meta">${escapeHTML(photo.caption || "")}</p>
      </div>
    `;
  }));

  $("detail-title").textContent = recipe.name || "Recipe details";
  $("detail-content").innerHTML = `
    <span class="category-tag">${escapeHTML(recipe.category || "Other")}</span>
    <p class="recipe-meta">${escapeHTML(formatDate(recipe.baked_on))} · ${escapeHTML(recipe.difficulty || "Easy")}</p>

    <div class="detail-toolbar">
      <button class="secondary-button" id="edit-current-recipe" type="button">Edit recipe</button>
      <button class="secondary-button" id="delete-current-recipe" type="button">Delete recipe</button>
    </div>

    <div class="detail-section">
      <h3>Recipe source</h3>
      <p>${escapeHTML(recipe.source || "Not recorded")}</p>
    </div>
    <div class="detail-section">
      <h3>Ingredients</h3>
      <p class="detail-text">${escapeHTML(recipe.ingredients || "No ingredients recorded.")}</p>
    </div>
    <div class="detail-section">
      <h3>Instructions</h3>
      <p class="detail-text">${escapeHTML(recipe.instructions || "No instructions recorded.")}</p>
    </div>

    <div class="detail-section">
      <h3>My baking photos</h3>
      <div class="photo-grid">${photoElements.join("") || "<p>No photos uploaded yet.</p>"}</div>
      <label for="photo-upload">Add more photos</label>
      <input id="photo-upload" type="file" accept="image/*" multiple>
      <label for="photo-caption">Photo caption (optional)</label>
      <input id="photo-caption" maxlength="200" placeholder="Describe these photos...">
      <button class="primary-button" id="upload-photos" type="button">Upload photos</button>
      <p class="muted small">You can select multiple images at once.</p>
    </div>

    <div class="review-box">
      <h3>My review</h3>
      <p class="muted small">There is one editable review per recipe. Saving again updates it.</p>
      <form id="review-form">
        <label for="review-rating">Rating</label>
        <select id="review-rating">
          <option value="5">★★★★★ - 5</option>
          <option value="4">★★★★ - 4</option>
          <option value="3">★★★ - 3</option>
          <option value="2">★★ - 2</option>
          <option value="1">★ - 1</option>
        </select>
        <label for="review-text">My thoughts</label>
        <textarea id="review-text" rows="3" placeholder="How did it turn out?"></textarea>
        <label for="review-next">Next time I would...</label>
        <textarea id="review-next" rows="3" placeholder="What would you change?"></textarea>
        <button class="primary-button" type="submit" id="save-review">Save review</button>
      </form>
    </div>
  `;

  if (review) {
    $("review-rating").value = String(review.rating || 5);
    $("review-text").value = review.review || "";
    $("review-next").value = review.next_time || "";
  }

  $("detail-modal").classList.remove("hidden");
  $("edit-current-recipe").addEventListener("click", () => {
    $("detail-modal").classList.add("hidden");
    openRecipeForm(recipe);
  });
  $("delete-current-recipe").addEventListener("click", () => deleteRecipe(recipe));
  $("upload-photos").addEventListener("click", uploadPhotos);
  $("review-form").addEventListener("submit", saveReview);

  document.querySelectorAll("[data-delete-photo]").forEach(button => {
    button.addEventListener("click", () => deletePhoto(button.dataset.deletePhoto));
  });
}

document.addEventListener("click", event => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest("[data-open-recipe]");
  if (button) openRecipe(button.dataset.openRecipe);
});

document.querySelectorAll("[data-close-detail]").forEach(button => {
  button.addEventListener("click", () => $("detail-modal").classList.add("hidden"));
});

// -----------------------------------------------------
// Reviews
// -----------------------------------------------------

async function saveReview(event) {
  event.preventDefault();
  if (!currentRecipe || !currentUser) return;

  const button = $("save-review");
  setButtonLoading(button, true);

  try {
    const reviewData = {
      recipe_id: currentRecipe.id,
      user_id: currentUser.id,
      rating: Number($("review-rating").value),
      review: $("review-text").value.trim(),
      next_time: $("review-next").value.trim()
    };

    const { error } = await supabaseClient
      .from("reviews")
      .upsert(reviewData, { onConflict: "recipe_id" });

    if (error) throw error;
    await loadAllData();
    showMessage("Your review has been saved!", "success");
  } catch (error) {
    showMessage("Could not save review: " + error.message, "error");
  } finally {
    setButtonLoading(button, false);
  }
}

// -----------------------------------------------------
// Photo uploads
// -----------------------------------------------------

async function uploadPhotos() {
  if (!currentRecipe || !currentUser) return;

  const files = Array.from($("photo-upload").files || []);
  const caption = $("photo-caption").value.trim();
  const button = $("upload-photos");

  if (!files.length) {
    showMessage("Please select at least one photo.", "error");
    return;
  }
  if (files.some(file => !file.type.startsWith("image/"))) {
    showMessage("Please select image files only.", "error");
    return;
  }
  if (files.some(file => file.size > 10 * 1024 * 1024)) {
    showMessage("Each image must be smaller than 10 MB.", "error");
    return;
  }

  setButtonLoading(button, true, "Uploading...");

  try {
    for (const file of files) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const uniqueName = `${Date.now()}-${crypto.randomUUID()}-${safeName}`;
      const storagePath = `${currentUser.id}/${currentRecipe.id}/${uniqueName}`;

      const { error: uploadError } = await supabaseClient.storage
        .from(BUCKET)
        .upload(storagePath, file, { contentType: file.type, upsert: false });

      if (uploadError) throw uploadError;

      const { error: insertError } = await supabaseClient
        .from("photos")
        .insert({
          recipe_id: currentRecipe.id,
          user_id: currentUser.id,
          storage_path: storagePath,
          caption
        });

      if (insertError) {
        await supabaseClient.storage.from(BUCKET).remove([storagePath]);
        throw insertError;
      }
    }

    const recipeId = currentRecipe.id;
    await loadAllData();
    await openRecipe(recipeId);
    showMessage("Photos uploaded successfully!", "success");
  } catch (error) {
    showMessage("Photo upload failed: " + error.message, "error");
  } finally {
    setButtonLoading(button, false);
  }
}

// -----------------------------------------------------
// Delete photo or recipe
// -----------------------------------------------------

async function deletePhoto(photoId) {
  const photo = photos.find(item => String(item.id) === String(photoId));
  if (!photo || !confirm("Remove this photo?")) return;

  try {
    const { error: storageError } = await supabaseClient.storage
      .from(BUCKET)
      .remove([photo.storage_path]);
    if (storageError) throw storageError;

    const { error: rowError } = await supabaseClient
      .from("photos")
      .delete()
      .eq("id", photo.id);
    if (rowError) throw rowError;

    const recipeId = currentRecipe.id;
    await loadAllData();
    await openRecipe(recipeId);
    showMessage("Photo removed.", "success");
  } catch (error) {
    showMessage("Could not remove photo: " + error.message, "error");
  }
}

async function deleteRecipe(recipe) {
  if (!confirm(`Delete “${recipe.name}” and its reviews and photos? This cannot be undone.`)) return;

  try {
    const recipePhotos = getRecipePhotos(recipe.id);
    const storagePaths = recipePhotos.map(photo => photo.storage_path).filter(Boolean);

    if (storagePaths.length) {
      const { error } = await supabaseClient.storage.from(BUCKET).remove(storagePaths);
      if (error) throw error;
    }

    if (recipePhotos.length) {
      const { error } = await supabaseClient.from("photos").delete().eq("recipe_id", recipe.id);
      if (error) throw error;
    }

    const recipeReview = getReview(recipe.id);
    if (recipeReview) {
      const { error } = await supabaseClient.from("reviews").delete().eq("recipe_id", recipe.id);
      if (error) throw error;
    }

    const { error } = await supabaseClient.from("recipes").delete().eq("id", recipe.id);
    if (error) throw error;

    $("detail-modal").classList.add("hidden");
    currentRecipe = null;
    await loadAllData();
    showMessage("Recipe deleted.", "success");
  } catch (error) {
    showMessage("Could not delete recipe: " + error.message, "error");
  }
}

// -----------------------------------------------------
// Export personal JSON and full ZIP backups (read-only)
// -----------------------------------------------------

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Delay revocation so mobile browsers can begin reading the generated file.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

$("export-backup").addEventListener("click", () => {
  const backup = {
    exported_at: new Date().toISOString(),
    recipes,
    reviews,
    photos
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  downloadBlob(blob, `little-bakebook-backup-${new Date().toISOString().slice(0, 10)}.json`);
});

function setFullBackupProgress(message, value, total) {
  const progress = $("full-backup-progress");
  const text = $("full-backup-progress-text");
  progress.classList.remove("hidden");
  progress.value = total ? Math.round((value / total) * 100) : 0;
  text.textContent = message;
}

function getArchivePhotoName(photo, index) {
  const lastPathPart = String(photo.storage_path || "photo").split("/").pop() || "photo";
  const safeName = lastPathPart.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `photos/${String(index + 1).padStart(4, "0")}-${safeName}`;
}

$("export-full-backup").addEventListener("click", async () => {
  const button = $("export-full-backup");
  const progress = $("full-backup-progress");
  const failuresList = $("full-backup-failures");

  if (!currentUser) {
    showMessage("Please sign in before creating a backup.", "error");
    return;
  }
  if (!window.JSZip) {
    showMessage("The ZIP library could not be loaded. Check your connection and try again.", "error");
    return;
  }

  setButtonLoading(button, true, "Preparing ZIP...");
  failuresList.replaceChildren();
  failuresList.classList.add("hidden");
  progress.classList.remove("hidden");
  progress.value = 0;

  try {
    const zip = new window.JSZip();
    const failures = [];
    const photoRecords = [];

    for (let index = 0; index < photos.length; index += 1) {
      const photo = photos[index];
      const archivePath = getArchivePhotoName(photo, index);
      setFullBackupProgress(`Downloading photo ${index + 1} of ${photos.length}…`, index, photos.length);

      try {
        if (!photo.storage_path) throw new Error("Photo record has no storage path.");
        // Storage SDK attaches the active Supabase session; no public URL or service key is used.
        const { data, error } = await supabaseClient.storage.from(BUCKET).download(photo.storage_path);
        if (error) throw error;
        if (!data) throw new Error("Storage returned an empty file.");
        zip.file(archivePath, data, { binary: true });
        photoRecords.push({ ...photo, backup_file: archivePath });
      } catch (error) {
        const failure = {
          photo_id: photo.id ?? null,
          storage_path: photo.storage_path ?? null,
          error: error?.message || "Download failed."
        };
        failures.push(failure);
        photoRecords.push({ ...photo, backup_file: null });
      }
    }

    const backup = {
      exported_at: new Date().toISOString(),
      recipes,
      reviews,
      photos: photoRecords,
      photo_download_failures: failures
    };
    zip.file("backup.json", JSON.stringify(backup, null, 2));

    setFullBackupProgress("Packaging ZIP for download…", 0, 1);
    const blob = await zip.generateAsync(
      { type: "blob", mimeType: "application/zip", compression: "STORE" },
      metadata => setFullBackupProgress(`Packaging ZIP… ${Math.round(metadata.percent)}%`, metadata.percent, 100)
    );
    downloadBlob(blob, `little-bakebook-full-backup-${new Date().toISOString().slice(0, 10)}.zip`);

    progress.value = 100;
    if (failures.length) {
      failuresList.innerHTML = failures.map(failure =>
        `<li>Photo ${escapeHTML(failure.photo_id ?? "(unknown)")} (${escapeHTML(failure.storage_path || "no path")}): ${escapeHTML(failure.error)}</li>`
      ).join("");
      failuresList.classList.remove("hidden");
      $("full-backup-progress-text").textContent = `ZIP downloaded with ${failures.length} photo download failure${failures.length === 1 ? "" : "s"}. See the list below; failures are also recorded in backup.json.`;
      showMessage("Full backup downloaded, but some photos could not be included.", "error");
    } else {
      $("full-backup-progress-text").textContent = `Full backup downloaded successfully (${photos.length} photo${photos.length === 1 ? "" : "s"}).`;
      showMessage("Full backup downloaded successfully.", "success");
    }
  } catch (error) {
    $("full-backup-progress-text").textContent = `Backup failed: ${error?.message || "Unknown error."}`;
    showMessage("Could not create full backup: " + (error?.message || "Unknown error."), "error");
  } finally {
    setButtonLoading(button, false);
  }
});

initialise();
