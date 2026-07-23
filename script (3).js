/* =========================================================
   COFRE — Metas de Compra
   Vanilla JS — sem dependências externas
   Tudo persistido em localStorage.
   ========================================================= */

(function () {
  "use strict";

  /* --------------------- CONSTANTES --------------------- */
  const STORAGE_KEY = "cofreApp_v1";
  const RING_RADIUS = 36;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

  const PRIORITY_LABELS = [
    { max: 2, label: "Muito baixa", color: "var(--p-red)" },
    { max: 4, label: "Baixa", color: "var(--p-orange)" },
    { max: 6, label: "Média", color: "var(--p-yellow)" },
    { max: 8, label: "Alta", color: "var(--p-lightgreen)" },
    { max: 10, label: "Urgente", color: "var(--p-green)" }
  ];

  const REMINDER_MESSAGES = [
    (g) => `Que tal guardar R$20 para "${g.name}" hoje?`,
    (g) => `Faltam apenas ${formatBRL(remaining(g))} para concluir "${g.name}".`,
    (g) => `Você está ${percent(g)}% do caminho em "${g.name}". Continue!`
  ];

  /* --------------------- ESTADO --------------------- */
  let state = loadState();
  let currentFilters = new Set();
  let currentSearch = "";
  let currentSort = "priority-desc";
  let moneyModalContext = null; // { id, mode: 'deposit' | 'withdraw' }
  let confirmContext = null; // { type: 'delete'|'archive', id }

  /* --------------------- PERSISTÊNCIA --------------------- */
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      console.warn("Falha ao ler localStorage:", e);
    }
    return { purchases: [], theme: "light", lastReminderCheck: null };
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("Falha ao salvar localStorage:", e);
    }
  }

  /* --------------------- HELPERS FINANCEIROS --------------------- */
  function formatBRL(v) {
    const n = Number(v) || 0;
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function remaining(g) {
    return Math.max(0, (Number(g.totalValue) || 0) - (Number(g.saved) || 0));
  }

  function percent(g) {
    if (!g.totalValue || g.totalValue <= 0) return 0;
    const p = ((Number(g.saved) || 0) / g.totalValue) * 100;
    return Math.max(0, Math.min(100, Math.round(p)));
  }

  function isComplete(g) {
    return percent(g) >= 100;
  }

  function daysRemaining(g) {
    if (!g.targetDate) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(g.targetDate + "T00:00:00");
    const diff = Math.round((target - today) / 86400000);
    return diff;
  }

  function ringColor(pct) {
    if (pct >= 100) return "var(--p-green)";
    if (pct >= 76) return "var(--p-lightgreen)";
    if (pct >= 51) return "var(--p-yellow)";
    if (pct >= 26) return "var(--p-orange)";
    return "var(--p-red)";
  }

  function priorityInfo(priority) {
    const found = PRIORITY_LABELS.find((p) => priority <= p.max);
    return found || PRIORITY_LABELS[PRIORITY_LABELS.length - 1];
  }

  function goalStatus(g) {
    if (isComplete(g)) return "Concluído";
    const dr = daysRemaining(g);
    if (dr !== null && dr < 0) return "Atrasado";
    return "Em andamento";
  }

  /* --------------------- METAS FINANCEIRAS (dia/semana/mês) --------------------- */
  function financialTargets(g) {
    const rem = remaining(g);
    const dr = daysRemaining(g);
    if (dr === null || dr <= 0 || rem <= 0) {
      return { daily: 0, weekly: 0, monthly: 0 };
    }
    const daily = rem / dr;
    const weekly = daily * 7;
    const monthly = daily * 30;
    return { daily, weekly, monthly };
  }

  /* --------------------- CRUD DE METAS --------------------- */
  function createGoal(data) {
    const goal = {
      id: "g_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      name: data.name,
      category: data.category,
      photo: data.photo || null,
      totalValue: Number(data.totalValue) || 0,
      saved: Number(data.saved) || 0,
      description: data.description || "",
      priority: Number(data.priority),
      targetDate: data.targetDate || "",
      notes: data.notes || "",
      productLink: data.productLink || "",
      desiredPrice: data.desiredPrice ? Number(data.desiredPrice) : null,
      tag: data.tag || "desejo",
      archived: false,
      createdAt: new Date().toISOString(),
      history: []
    };
    if (goal.saved > 0) {
      goal.history.push(makeHistoryEntry(goal.saved, "deposit", "Valor inicial"));
    }
    state.purchases.push(goal);
    saveState();
    return goal;
  }

  function updateGoal(id, data) {
    const g = state.purchases.find((p) => p.id === id);
    if (!g) return;
    Object.assign(g, {
      name: data.name,
      category: data.category,
      photo: data.photo !== undefined ? data.photo : g.photo,
      totalValue: Number(data.totalValue) || 0,
      description: data.description || "",
      priority: Number(data.priority),
      targetDate: data.targetDate || "",
      notes: data.notes || "",
      productLink: data.productLink || "",
      desiredPrice: data.desiredPrice ? Number(data.desiredPrice) : null,
      tag: data.tag || "desejo"
    });
    // Ajuste manual do valor guardado, se alterado no formulário de edição
    if (data.saved !== undefined && Number(data.saved) !== g.saved) {
      g.saved = Math.max(0, Number(data.saved) || 0);
    }
    saveState();
  }

  function deleteGoal(id) {
    state.purchases = state.purchases.filter((p) => p.id !== id);
    saveState();
  }

  function archiveGoal(id, archived) {
    const g = state.purchases.find((p) => p.id === id);
    if (!g) return;
    g.archived = archived;
    saveState();
  }

  function makeHistoryEntry(amount, type, note) {
    const now = new Date();
    return {
      id: "h_" + now.getTime() + "_" + Math.random().toString(36).slice(2, 5),
      amount: amount,
      type: type, // 'deposit' | 'withdraw'
      date: now.toISOString(),
      note: note || ""
    };
  }

  function applyMoneyMovement(id, amount, type, note) {
    const g = state.purchases.find((p) => p.id === id);
    if (!g) return;
    const wasComplete = isComplete(g);
    let appliedAmount = amount;
    if (type === "deposit") {
      g.saved = (Number(g.saved) || 0) + amount;
    } else {
      // Nunca permitir valores negativos: limita a retirada ao que está guardado
      appliedAmount = Math.min(amount, Number(g.saved) || 0);
      g.saved = Math.max(0, (Number(g.saved) || 0) - appliedAmount);
    }
    g.history.unshift(makeHistoryEntry(appliedAmount, type, note));
    saveState();
    if (!wasComplete && isComplete(g)) {
      celebrateCompletion();
    }
    return g;
  }

  /* --------------------- RENDER: DASHBOARD --------------------- */
  function renderDashboard() {
    const active = state.purchases.filter((p) => !p.archived);
    const planned = active.reduce((s, g) => s + (Number(g.totalValue) || 0), 0);
    const saved = active.reduce((s, g) => s + (Number(g.saved) || 0), 0);
    const inProgress = active.filter((g) => !isComplete(g)).length;

    const now = new Date();
    const monthSaved = active.reduce((sum, g) => {
      const monthTotal = (g.history || [])
        .filter((h) => {
          const d = new Date(h.date);
          return (
            h.type === "deposit" &&
            d.getMonth() === now.getMonth() &&
            d.getFullYear() === now.getFullYear()
          );
        })
        .reduce((s, h) => s + h.amount, 0);
      return sum + monthTotal;
    }, 0);

    document.getElementById("dashMonthSaved").textContent = formatBRL(monthSaved);
    document.getElementById("dashPlanned").textContent = formatBRL(planned);
    document.getElementById("dashSaved").textContent = formatBRL(saved);
    document.getElementById("dashActive").textContent = String(inProgress);
  }

  /* --------------------- RENDER: RING SVG --------------------- */
  function ringSVG(pct) {
    const offset = RING_CIRCUMFERENCE * (1 - pct / 100);
    const color = ringColor(pct);
    return `
      <svg viewBox="0 0 86 86">
        <circle class="ring-track" cx="43" cy="43" r="${RING_RADIUS}" stroke-width="8"></circle>
        <circle class="ring-fill" cx="43" cy="43" r="${RING_RADIUS}" stroke-width="8"
          stroke="${color}"
          stroke-dasharray="${RING_CIRCUMFERENCE}"
          stroke-dashoffset="${RING_CIRCUMFERENCE}"
          data-target-offset="${offset}"></circle>
      </svg>
      <div class="ring-label"><span class="ring-percent" style="color:${color}">${pct}%</span></div>
    `;
  }

  function animateRings(container) {
    requestAnimationFrame(() => {
      container.querySelectorAll(".ring-fill").forEach((circle) => {
        const target = circle.getAttribute("data-target-offset");
        requestAnimationFrame(() => {
          circle.style.strokeDashoffset = target;
        });
      });
    });
  }

  /* --------------------- RENDER: CARD --------------------- */
  function cardHTML(g) {
    const pct = percent(g);
    const pInfo = priorityInfo(g.priority);
    const dr = daysRemaining(g);
    const complete = isComplete(g);

    let daysText = "Sem data definida";
    if (dr !== null) {
      if (dr < 0) daysText = `Atrasado há ${Math.abs(dr)} dias`;
      else if (dr === 0) daysText = "É hoje!";
      else daysText = `Faltam ${dr} dias`;
    }

    const photoBlock = g.photo
      ? `<img class="gc-photo" src="${g.photo}" alt="${escapeHTML(g.name)}">`
      : `<div class="gc-photo-placeholder">${categoryIcon(g.category)}</div>`;

    return `
      <article class="goal-card ${complete ? "is-complete" : ""}" data-id="${g.id}" tabindex="0">
        ${complete ? `<span class="gc-complete-badge">✔️ Concluído</span>` : ""}
        <div class="gc-top">
          ${photoBlock}
          <div class="gc-title-wrap">
            <p class="gc-name">${escapeHTML(g.name)}</p>
            <span class="gc-category">${escapeHTML(g.category)}</span>
          </div>
          <span class="gc-tag ${g.tag}">${tagLabel(g.tag)}</span>
        </div>

        <div class="gc-body">
          <div class="ring-wrap">${ringSVG(pct)}</div>
          <div class="gc-numbers">
            <div class="row"><span class="label">Valor</span><span class="value total">${formatBRL(g.totalValue)}</span></div>
            <div class="row"><span class="label">Guardado</span><span class="value saved">${formatBRL(g.saved)}</span></div>
            <div class="row"><span class="label">Falta</span><span class="value missing">${formatBRL(remaining(g))}</span></div>
          </div>
        </div>

        <div class="gc-footer">
          <span class="priority-pill" style="background:color-mix(in srgb, ${pInfo.color} 18%, transparent); color:${pInfo.color}">
            <span class="priority-dot" style="background:${pInfo.color}"></span>P${g.priority} · ${pInfo.label}
          </span>
          <span>${daysText}</span>
        </div>

        <div class="gc-actions">
          <button class="gc-btn deposit" data-action="deposit" data-id="${g.id}">
            <svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
            Depositar
          </button>
          <button class="gc-btn withdraw" data-action="withdraw" data-id="${g.id}">
            <svg viewBox="0 0 24 24" width="14" height="14"><path d="M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
            Retirar
          </button>
        </div>
      </article>
    `;
  }

  function tagLabel(tag) {
    return { desejo: "Desejo", necessidade: "Necessidade", presente: "Presente" }[tag] || tag;
  }

  function categoryIcon() {
    return `<svg viewBox="0 0 24 24" width="24" height="24"><rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 4v16M4 8h16" stroke="currentColor" stroke-width="1.2" opacity="0.5"/></svg>`;
  }

  function escapeHTML(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  /* --------------------- FILTRO / BUSCA / ORDENAÇÃO --------------------- */
  function getVisibleGoals() {
    let goals = state.purchases.filter((g) => !g.archived);

    if (currentSearch.trim()) {
      const q = currentSearch.trim().toLowerCase();
      goals = goals.filter(
        (g) => g.name.toLowerCase().includes(q) || g.category.toLowerCase().includes(q)
      );
    }

    if (currentFilters.size) {
      goals = goals.filter((g) => {
        const pct = percent(g);
        return [...currentFilters].every((f) => {
          switch (f) {
            case "concluidos": return isComplete(g);
            case "andamento": return !isComplete(g);
            case "mais80": return pct > 80;
            case "menos20": return pct < 20;
            case "altaprioridade": return g.priority >= 7;
            case "baixaprioridade": return g.priority <= 4;
            default: return true;
          }
        });
      });
    }

    goals.sort((a, b) => {
      switch (currentSort) {
        case "priority-desc": return b.priority - a.priority;
        case "percent-desc": return percent(b) - percent(a);
        case "percent-asc": return percent(a) - percent(b);
        case "value-desc": return b.totalValue - a.totalValue;
        case "value-asc": return a.totalValue - b.totalValue;
        case "date-asc": return dateSortValue(a) - dateSortValue(b);
        case "date-desc": return dateSortValue(b) - dateSortValue(a);
        case "name-asc": return a.name.localeCompare(b.name, "pt-BR");
        case "category-asc": return a.category.localeCompare(b.category, "pt-BR");
        default: return 0;
      }
    });

    return goals;
  }

  function dateSortValue(g) {
    return g.targetDate ? new Date(g.targetDate).getTime() : Infinity;
  }

  /* --------------------- RENDER PRINCIPAL --------------------- */
  function renderAll() {
    renderDashboard();
    const grid = document.getElementById("cardsGrid");
    const empty = document.getElementById("emptyState");
    const goals = getVisibleGoals();

    if (!goals.length) {
      grid.innerHTML = "";
      empty.hidden = false;
    } else {
      empty.hidden = true;
      grid.innerHTML = goals.map(cardHTML).join("");
      animateRings(grid);
    }
    updateFilterCount();
    checkReminder();
  }

  function updateFilterCount() {
    const el = document.getElementById("filterCount");
    if (currentFilters.size) {
      el.hidden = false;
      el.textContent = String(currentFilters.size);
    } else {
      el.hidden = true;
    }
  }

  /* --------------------- LEMBRETES / NOTIFICAÇÕES --------------------- */
  function checkReminder() {
    const banner = document.getElementById("reminderBanner");
    const active = state.purchases.filter((g) => !g.archived && !isComplete(g));
    if (!active.length) {
      banner.hidden = true;
      return;
    }
    // Escolhe a meta com maior prioridade e mais próxima da conclusão para lembrar
    const pick = [...active].sort((a, b) => {
      const pctDiff = percent(b) - percent(a);
      if (pctDiff !== 0) return pctDiff;
      return b.priority - a.priority;
    })[0];

    const msgFn = REMINDER_MESSAGES[Math.floor(Math.random() * REMINDER_MESSAGES.length)];
    document.getElementById("reminderText").textContent = msgFn(pick);
    banner.hidden = false;
  }

  /* --------------------- ESTATÍSTICAS --------------------- */
  function renderStats() {
    const goals = state.purchases.filter((g) => !g.archived);
    const total = goals.length;
    const planned = goals.reduce((s, g) => s + g.totalValue, 0);
    const saved = goals.reduce((s, g) => s + g.saved, 0);
    const remainingTotal = goals.reduce((s, g) => s + remaining(g), 0);
    const completed = goals.filter(isComplete).length;
    const inProgress = total - completed;
    const priorityAvg = total ? (goals.reduce((s, g) => s + g.priority, 0) / total).toFixed(1) : "0.0";

    let mostExpensive = null,
      closestToComplete = null;
    goals.forEach((g) => {
      if (!mostExpensive || g.totalValue > mostExpensive.totalValue) mostExpensive = g;
      if (!isComplete(g)) {
        if (!closestToComplete || percent(g) > percent(closestToComplete)) closestToComplete = g;
      }
    });

    const box = (label, value) => `
      <div class="stat-box"><span class="s-label">${label}</span><span class="s-value">${value}</span></div>
    `;

    document.getElementById("statsBody").innerHTML = `
      <div class="stats-grid">
        ${box("Total de objetivos", total)}
        ${box("Valor total planejado", formatBRL(planned))}
        ${box("Valor já guardado", formatBRL(saved))}
        ${box("Valor restante", formatBRL(remainingTotal))}
        ${box("Concluídos", completed)}
        ${box("Em andamento", inProgress)}
        ${box("Objetivo mais caro", mostExpensive ? escapeHTML(mostExpensive.name) : "—")}
        ${box("Mais próximo da conclusão", closestToComplete ? escapeHTML(closestToComplete.name) : "—")}
        ${box("Prioridade média", priorityAvg)}
      </div>
    `;
  }

  /* --------------------- ARQUIVADAS --------------------- */
  function renderArchive() {
    const archived = state.purchases.filter((g) => g.archived);
    const body = document.getElementById("archiveBody");
    if (!archived.length) {
      body.innerHTML = `<p style="color:var(--ink-soft);text-align:center;padding:20px 0;">Nenhuma meta arquivada ainda.</p>`;
      return;
    }
    body.innerHTML = archived
      .map(
        (g) => `
        <div class="archive-item">
          <div>
            <p class="a-name">${escapeHTML(g.name)}</p>
            <p class="a-sub">${formatBRL(g.totalValue)} · concluído em ${percent(g)}%</p>
          </div>
          <button data-unarchive="${g.id}">Restaurar</button>
        </div>
      `
      )
      .join("");
  }

  /* --------------------- DETALHES --------------------- */
  function openDetail(id) {
    const g = state.purchases.find((p) => p.id === id);
    if (!g) return;
    const pct = percent(g);
    const dr = daysRemaining(g);
    const ft = financialTargets(g);
    const pInfo = priorityInfo(g.priority);

    let daysText = "Sem data definida";
    if (dr !== null) {
      daysText = dr < 0 ? `Atrasado há ${Math.abs(dr)} dias` : dr === 0 ? "É hoje!" : `${dr} dias`;
    }

    const desiredHit =
      g.desiredPrice && g.totalValue <= g.desiredPrice
        ? `<div class="desired-price-hit">🎯 Este item está no valor desejado ou abaixo dele!</div>`
        : "";

    const linkRow = g.productLink
      ? `<p class="link-row"><a href="${g.productLink}" target="_blank" rel="noopener noreferrer">Ver produto ↗</a></p>`
      : "";

    const historyHTML = g.history.length
      ? `<ul class="history-list">${g.history
          .map(
            (h) => `
          <li class="history-item">
            <div class="h-left">
              <span>${new Date(h.date).toLocaleDateString("pt-BR")} · ${new Date(h.date).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
              ${h.note ? `<span class="h-note">${escapeHTML(h.note)}</span>` : ""}
            </div>
            <span class="h-amount ${h.type}">${h.type === "deposit" ? "+" : "-"} ${formatBRL(h.amount)}</span>
          </li>
        `
          )
          .join("")}</ul>`
      : `<p style="color:var(--ink-soft);font-size:0.85rem;">Nenhuma movimentação ainda.</p>`;

    document.getElementById("detailBody").innerHTML = `
      ${g.photo ? `<img class="detail-photo" src="${g.photo}" alt="${escapeHTML(g.name)}">` : ""}
      <div class="detail-header">
        <div>
          <h3 class="detail-name">${escapeHTML(g.name)}</h3>
          <span class="gc-category">${escapeHTML(g.category)} · ${goalStatus(g)}</span>
        </div>
        <span class="gc-tag ${g.tag}">${tagLabel(g.tag)}</span>
      </div>
      ${g.description ? `<p class="detail-desc">${escapeHTML(g.description)}</p>` : ""}
      ${desiredHit}
      ${linkRow}

      <div class="detail-ring-row">
        <div class="ring-wrap" style="width:100px;height:100px;">${ringSVG(pct)}</div>
        <div class="detail-numbers">
          <div class="row"><span class="label">Valor total</span><span class="value">${formatBRL(g.totalValue)}</span></div>
          <div class="row"><span class="label">Guardado</span><span class="value" style="color:var(--accent)">${formatBRL(g.saved)}</span></div>
          <div class="row"><span class="label">Restante</span><span class="value" style="color:var(--p-orange)">${formatBRL(remaining(g))}</span></div>
          <div class="row"><span class="label">Prioridade</span><span class="value" style="color:${pInfo.color}">P${g.priority} · ${pInfo.label}</span></div>
          <div class="row"><span class="label">Dias restantes</span><span class="value">${daysText}</span></div>
        </div>
      </div>

      <div class="goal-meta-grid">
        <div class="goal-meta-item"><div class="label">Meta diária</div><div class="value">${formatBRL(ft.daily)}</div></div>
        <div class="goal-meta-item"><div class="label">Meta semanal</div><div class="value">${formatBRL(ft.weekly)}</div></div>
        <div class="goal-meta-item"><div class="label">Meta mensal</div><div class="value">${formatBRL(ft.monthly)}</div></div>
      </div>

      ${g.notes ? `<p class="detail-desc"><strong>Observações:</strong> ${escapeHTML(g.notes)}</p>` : ""}

      <h4 style="margin:16px 0 8px;font-family:var(--font-display);">Histórico</h4>
      ${historyHTML}

      <div class="detail-actions">
        <button class="da-deposit" data-detail-action="deposit" data-id="${g.id}">Depositar</button>
        <button data-detail-action="withdraw" data-id="${g.id}">Retirar</button>
        <button data-detail-action="edit" data-id="${g.id}">Editar</button>
        <button data-detail-action="archive" data-id="${g.id}">${g.archived ? "Restaurar" : "Arquivar"}</button>
        <button class="da-delete" data-detail-action="delete" data-id="${g.id}">Excluir</button>
      </div>
    `;
    openModal("detailModal");
  }

  /* --------------------- MODAIS: abrir/fechar --------------------- */
  function openModal(id) {
    document.getElementById(id).hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeModal(id) {
    document.getElementById(id).hidden = true;
    document.body.style.overflow = "";
  }
  function closeAllModals() {
    document.querySelectorAll(".modal-overlay").forEach((m) => (m.hidden = true));
    document.body.style.overflow = "";
  }

  /* --------------------- FORMULÁRIO: abrir para criar/editar --------------------- */
  let editingPhotoData = null;

  function openFormForCreate() {
    document.getElementById("formModalTitle").textContent = "Nova meta";
    document.getElementById("purchaseForm").reset();
    document.getElementById("fieldId").value = "";
    document.getElementById("fieldPriority").value = 5;
    document.getElementById("priorityValueLabel").textContent = "5";
    document.getElementById("fieldPhotoPreview").hidden = true;
    editingPhotoData = null;
    openModal("formModal");
  }

  function openFormForEdit(id) {
    const g = state.purchases.find((p) => p.id === id);
    if (!g) return;
    document.getElementById("formModalTitle").textContent = "Editar meta";
    document.getElementById("fieldId").value = g.id;
    document.getElementById("fieldName").value = g.name;
    document.getElementById("fieldCategory").value = g.category;
    document.getElementById("fieldTag").value = g.tag;
    document.getElementById("fieldTotal").value = g.totalValue;
    document.getElementById("fieldSaved").value = g.saved;
    document.getElementById("fieldPriority").value = g.priority;
    document.getElementById("priorityValueLabel").textContent = String(g.priority);
    document.getElementById("fieldDate").value = g.targetDate || "";
    document.getElementById("fieldDescription").value = g.description || "";
    document.getElementById("fieldLink").value = g.productLink || "";
    document.getElementById("fieldDesiredPrice").value = g.desiredPrice || "";
    document.getElementById("fieldNotes").value = g.notes || "";

    const preview = document.getElementById("fieldPhotoPreview");
    if (g.photo) {
      preview.src = g.photo;
      preview.hidden = false;
      editingPhotoData = g.photo;
    } else {
      preview.hidden = true;
      editingPhotoData = null;
    }
    openModal("formModal");
  }

  function readPhotoFile(file, callback) {
    if (!file) return callback(null);
    const reader = new FileReader();
    reader.onload = () => callback(reader.result);
    reader.readAsDataURL(file);
  }

  /* --------------------- CONFETES --------------------- */
  function celebrateCompletion() {
    const canvas = document.getElementById("confettiCanvas");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.display = "block";
    const ctx = canvas.getContext("2d");
    const colors = ["#2F6F5E", "#B98A1D", "#D6AE2B", "#6FAE58", "#C4483B"];
    const pieces = Array.from({ length: 120 }, () => ({
      x: Math.random() * canvas.width,
      y: -20 - Math.random() * canvas.height * 0.3,
      w: 6 + Math.random() * 6,
      h: 8 + Math.random() * 10,
      color: colors[Math.floor(Math.random() * colors.length)],
      speedY: 2 + Math.random() * 3,
      speedX: -1.5 + Math.random() * 3,
      rot: Math.random() * 360,
      rotSpeed: -8 + Math.random() * 16
    }));

    let frame = 0;
    const maxFrames = 130;
    function tick() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach((p) => {
        p.x += p.speedX;
        p.y += p.speedY;
        p.rot += p.rotSpeed;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rot * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      frame++;
      if (frame < maxFrames) {
        requestAnimationFrame(tick);
      } else {
        canvas.style.display = "none";
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    tick();
    showToast("✔️ Objetivo concluído!");
  }

  /* --------------------- TOAST --------------------- */
  let toastTimer = null;
  function showToast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, 2600);
  }

  /* --------------------- TEMA --------------------- */
  function applyTheme(theme) {
    document.body.setAttribute("data-theme", theme);
    document.getElementById("iconSun").style.display = theme === "light" ? "block" : "none";
    document.getElementById("iconMoon").style.display = theme === "dark" ? "block" : "none";
    state.theme = theme;
    saveState();
  }

  /* --------------------- CONFIRMAÇÃO --------------------- */
  function askConfirm(text, onConfirm) {
    document.getElementById("confirmText").textContent = text;
    confirmContext = onConfirm;
    openModal("confirmModal");
  }

  /* =========================================================
     LIGAÇÃO DE EVENTOS
     ========================================================= */
  document.addEventListener("DOMContentLoaded", init);

  function init() {
    applyTheme(state.theme || "light");
    renderAll();
    bindGlobalEvents();
  }

  function bindGlobalEvents() {
    // Fechar modais
    document.querySelectorAll("[data-close]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const overlay = e.target.closest(".modal-overlay");
        if (overlay) closeModal(overlay.id);
      });
    });
    document.querySelectorAll(".modal-overlay").forEach((overlay) => {
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeModal(overlay.id);
      });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAllModals();
    });

    // Tema
    document.getElementById("btnTheme").addEventListener("click", () => {
      applyTheme(state.theme === "light" ? "dark" : "light");
    });

    // Reminder
    document.getElementById("reminderClose").addEventListener("click", () => {
      document.getElementById("reminderBanner").hidden = true;
    });

    // Nova meta
    document.getElementById("btnNew").addEventListener("click", openFormForCreate);

    // Busca
    document.getElementById("searchInput").addEventListener("input", (e) => {
      currentSearch = e.target.value;
      renderAll();
    });

    // Ordenação
    document.getElementById("sortSelect").addEventListener("change", (e) => {
      currentSort = e.target.value;
      renderAll();
    });

    // Filtros: painel toggle
    document.getElementById("btnFilters").addEventListener("click", () => {
      const panel = document.getElementById("filterPanel");
      panel.hidden = !panel.hidden;
    });
    document.querySelectorAll(".filterChk").forEach((chk) => {
      chk.addEventListener("change", (e) => {
        if (e.target.checked) currentFilters.add(e.target.value);
        else currentFilters.delete(e.target.value);
        renderAll();
      });
    });

    // Estatísticas
    document.getElementById("btnStats").addEventListener("click", () => {
      renderStats();
      openModal("statsModal");
    });

    // Arquivadas
    document.getElementById("btnArchive").addEventListener("click", () => {
      renderArchive();
      openModal("archiveModal");
    });
    document.getElementById("archiveBody").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-unarchive]");
      if (!btn) return;
      archiveGoal(btn.getAttribute("data-unarchive"), false);
      renderArchive();
      renderAll();
      showToast("Meta restaurada.");
    });

    // Prioridade slider live label
    document.getElementById("fieldPriority").addEventListener("input", (e) => {
      document.getElementById("priorityValueLabel").textContent = e.target.value;
    });

    // Upload de foto
    document.getElementById("fieldPhotoFile").addEventListener("change", (e) => {
      const file = e.target.files[0];
      readPhotoFile(file, (dataUrl) => {
        editingPhotoData = dataUrl;
        const preview = document.getElementById("fieldPhotoPreview");
        if (dataUrl) {
          preview.src = dataUrl;
          preview.hidden = false;
        } else {
          preview.hidden = true;
        }
      });
    });

    // Submissão do formulário (criar/editar)
    document.getElementById("purchaseForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const id = document.getElementById("fieldId").value;
      const data = {
        name: document.getElementById("fieldName").value.trim(),
        category: document.getElementById("fieldCategory").value,
        tag: document.getElementById("fieldTag").value,
        photo: editingPhotoData,
        totalValue: document.getElementById("fieldTotal").value,
        saved: document.getElementById("fieldSaved").value,
        priority: document.getElementById("fieldPriority").value,
        targetDate: document.getElementById("fieldDate").value,
        description: document.getElementById("fieldDescription").value.trim(),
        productLink: document.getElementById("fieldLink").value.trim(),
        desiredPrice: document.getElementById("fieldDesiredPrice").value,
        notes: document.getElementById("fieldNotes").value.trim()
      };

      if (!data.name || !data.totalValue) {
        showToast("Preencha nome e valor total.");
        return;
      }

      if (id) {
        updateGoal(id, data);
        showToast("Meta atualizada.");
      } else {
        createGoal(data);
        showToast("Meta criada.");
      }
      closeModal("formModal");
      renderAll();
    });

    // Clique nos cards (delegado)
    document.getElementById("cardsGrid").addEventListener("click", (e) => {
      const actionBtn = e.target.closest("[data-action]");
      if (actionBtn) {
        e.stopPropagation();
        const id = actionBtn.getAttribute("data-id");
        const action = actionBtn.getAttribute("data-action");
        openMoneyModal(id, action);
        return;
      }
      const card = e.target.closest(".goal-card");
      if (card) openDetail(card.getAttribute("data-id"));
    });
    document.getElementById("cardsGrid").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const card = e.target.closest(".goal-card");
        if (card) openDetail(card.getAttribute("data-id"));
      }
    });

    // Ações dentro do modal de detalhes (delegado)
    document.getElementById("detailBody").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-detail-action]");
      if (!btn) return;
      const id = btn.getAttribute("data-id");
      const action = btn.getAttribute("data-detail-action");

      if (action === "deposit" || action === "withdraw") {
        closeModal("detailModal");
        openMoneyModal(id, action);
      } else if (action === "edit") {
        closeModal("detailModal");
        openFormForEdit(id);
      } else if (action === "archive") {
        const g = state.purchases.find((p) => p.id === id);
        archiveGoal(id, !g.archived);
        closeModal("detailModal");
        renderAll();
        showToast(g.archived ? "Meta arquivada." : "Meta restaurada.");
      } else if (action === "delete") {
        askConfirm("Deseja realmente excluir esta meta?", () => {
          deleteGoal(id);
          closeModal("detailModal");
          renderAll();
          showToast("Meta excluída.");
        });
      }
    });

    // Modal de dinheiro: valores rápidos
    document.getElementById("quickAmounts").addEventListener("click", (e) => {
      const chip = e.target.closest(".chip-amount");
      if (!chip) return;
      document.querySelectorAll(".chip-amount").forEach((c) => c.classList.remove("active"));
      const amountInput = document.getElementById("moneyAmount");
      const val = chip.getAttribute("data-amount");
      if (val === "custom") {
        chip.classList.add("active");
        amountInput.value = "";
        amountInput.focus();
      } else {
        chip.classList.add("active");
        amountInput.value = val;
      }
    });

    document.getElementById("moneyConfirm").addEventListener("click", () => {
      if (!moneyModalContext) return;
      const amount = parseFloat(document.getElementById("moneyAmount").value);
      if (!amount || amount <= 0) {
        showToast("Informe um valor válido.");
        return;
      }
      if (moneyModalContext.mode === "withdraw") {
        const g = state.purchases.find((p) => p.id === moneyModalContext.id);
        if (g && amount > g.saved) {
          showToast("Valor maior do que o guardado. Ajustado para o máximo disponível.");
        }
      }
      const note = document.getElementById("moneyNote").value.trim();
      const g = applyMoneyMovement(moneyModalContext.id, amount, moneyModalContext.mode, note);
      closeModal("moneyModal");
      renderAll();
      showToast(
        moneyModalContext.mode === "deposit"
          ? `Depósito de ${formatBRL(amount)} adicionado.`
          : `Retirada de ${formatBRL(amount)} registrada.`
      );
      moneyModalContext = null;
    });

    // Confirmação genérica
    document.getElementById("confirmOk").addEventListener("click", () => {
      const cb = confirmContext;
      closeModal("confirmModal");
      confirmContext = null;
      if (typeof cb === "function") cb();
    });
    document.getElementById("confirmCancel").addEventListener("click", () => {
      closeModal("confirmModal");
      confirmContext = null;
    });
  }

  function openMoneyModal(id, mode) {
    const g = state.purchases.find((p) => p.id === id);
    if (!g) return;
    moneyModalContext = { id, mode };
    document.getElementById("moneyModalTitle").textContent =
      mode === "deposit" ? "Depositar dinheiro" : "Retirar dinheiro";
    document.getElementById("moneyTargetName").textContent = g.name;
    document.getElementById("moneyAmount").value = "";
    document.getElementById("moneyNote").value = "";
    document.querySelectorAll(".chip-amount").forEach((c) => c.classList.remove("active"));

    // Se for retirada, limita o valor máximo ao que está guardado
    const amountInput = document.getElementById("moneyAmount");
    if (mode === "withdraw") {
      amountInput.max = g.saved;
    } else {
      amountInput.removeAttribute("max");
    }

    openModal("moneyModal");
  }
})();
