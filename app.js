import { APP_CONFIG, STORAGE_KEYS } from "./config.js";
import { MATCHES, MATCH_MAP } from "./matches.js";
import {
  auth,
  collection,
  db,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  signInAnonymously,
  where,
} from "./firebase.js";

const els = {
  countdownHint: document.getElementById("countdownHint"),
  countdownValue: document.getElementById("countdownValue"),
  cutoffBadge: document.getElementById("cutoffBadge"),
  homeMessage: document.getElementById("homeMessage"),
  homeTab: document.getElementById("homeTab"),
  leaderboardList: document.getElementById("leaderboardList"),
  leaderboardTab: document.getElementById("leaderboardTab"),
  loginError: document.getElementById("loginError"),
  loginForm: document.getElementById("loginForm"),
  loginModal: document.getElementById("loginModal"),
  logoutBtn: document.getElementById("logoutBtn"),
  matchState: document.getElementById("matchState"),
  matchTeams: document.getElementById("matchTeams"),
  nameInput: document.getElementById("nameInput"),
  playerBadge: document.getElementById("playerBadge"),
  predictionsList: document.getElementById("predictionsList"),
  predictionChart: document.getElementById("predictionChart"),
  resultsGuard: document.getElementById("resultsGuard"),
  resultsHeading: document.getElementById("resultsHeading"),
  resultsLockState: document.getElementById("resultsLockState"),
  resultsSummary: document.getElementById("resultsSummary"),
  resultsTab: document.getElementById("resultsTab"),
  selectedState: document.getElementById("selectedState"),
  statusCard: document.getElementById("statusCard"),
  teamABtn: document.getElementById("teamABtn"),
  teamBBtn: document.getElementById("teamBBtn"),
  todayLabel: document.getElementById("todayLabel"),
};

const allowedUserMap = APP_CONFIG.allowedUsers.reduce((acc, name) => {
  acc[name.toLowerCase()] = name;
  return acc;
}, {});

const state = {
  chart: null,
  playerKey: localStorage.getItem(STORAGE_KEYS.playerKey) || "",
  playerName: localStorage.getItem(STORAGE_KEYS.playerName) || "",
  predictionsCache: [],
  resultsCache: [],
  serverOffsetMs: 0,
  todayMatch: null,
  todayPrediction: null,
  todayPredictions: [],
  unsubscribers: [],
};

const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatCurrency(value) {
  return currency.format(value);
}

function getIstDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone: APP_CONFIG.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function getServerNow() {
  return new Date(Date.now() + state.serverOffsetMs);
}

function getCurrentMatch() {
  const todayIst = getIstDateString(getServerNow());
  return MATCHES.find((match) => match.date === todayIst) || null;
}

function isCutoffPassed(match) {
  if (!match) return false;
  return getServerNow().getTime() >= new Date(match.cutoffAt).getTime();
}

function hide(el, hidden = true) {
  el.classList.toggle("hidden", hidden);
}

function showMessage(el, message, hidden = false) {
  el.textContent = message;
  hide(el, hidden);
}

function clearSubscriptions() {
  state.unsubscribers.forEach((unsubscribe) => unsubscribe());
  state.unsubscribers = [];
}

function updateTodayMatch() {
  state.todayMatch = getCurrentMatch();
  const match = state.todayMatch;

  if (!match) {
    els.todayLabel.textContent = "No match scheduled today";
    els.matchState.textContent = "There is no 7:30 PM IST match in the hardcoded schedule for today.";
    hide(els.matchTeams, true);
    hide(els.selectedState, true);
    showMessage(els.homeMessage, "Update matches.js if you want to extend the schedule.", false);
    return;
  }

  els.todayLabel.textContent = `${match.teamA} vs ${match.teamB}`;
  els.matchState.textContent = `Match ${match.matchNumber} • ${match.venue}`;
  els.resultsHeading.textContent = `${match.teamA} vs ${match.teamB}`;
  hide(els.matchTeams, false);
  hide(els.homeMessage, true);

  els.teamABtn.textContent = match.teamA;
  els.teamBBtn.textContent = match.teamB;
  els.teamABtn.dataset.team = match.teamA;
  els.teamBBtn.dataset.team = match.teamB;

  renderPredictionSelection();
  refreshCountdown();
}

function refreshCountdown() {
  const match = state.todayMatch;
  if (!match) {
    els.countdownValue.textContent = "--:--:--";
    els.countdownHint.textContent = "Waiting for the next configured match day.";
    return;
  }

  const diff = new Date(match.cutoffAt).getTime() - getServerNow().getTime();
  const locked = diff <= 0;

  if (locked) {
    els.countdownValue.textContent = "Locked";
    els.countdownHint.textContent = "Submissions are closed. Final predictions are now visible.";
    els.resultsLockState.textContent = "Visible after cutoff";
    return;
  }

  const totalSeconds = Math.max(0, Math.floor(diff / 1000));
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");

  els.countdownValue.textContent = `${hours}:${minutes}:${seconds}`;
  els.countdownHint.textContent = "Last server-timestamped prediction before 7:30 PM IST will count.";
  els.resultsLockState.textContent = "Hidden before cutoff";
}

function renderPredictionSelection() {
  const match = state.todayMatch;
  const locked = isCutoffPassed(match);
  const selectedTeam = state.todayPrediction?.selectedTeam || "";

  [els.teamABtn, els.teamBBtn].forEach((button) => {
    button.disabled = locked || !match;
    button.classList.toggle("active", button.dataset.team === selectedTeam);
  });

  if (!selectedTeam) {
    hide(els.selectedState, true);
    return;
  }

  const submittedText = state.todayPrediction?.updatedAt
    ? `Saved on server at ${formatDateTime(state.todayPrediction.updatedAt.toDate())}`
    : "Saved and waiting for server timestamp...";

  els.selectedState.textContent = `Your latest pick: ${selectedTeam}. ${submittedText}`;
  hide(els.selectedState, false);
}

function formatDateTime(date) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: APP_CONFIG.timezone,
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function waitForCommittedServerClock(clockRef) {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out while syncing Firestore server time."));
    }, 10000);

    const unsubscribe = onSnapshot(
      clockRef,
      { includeMetadataChanges: true },
      (snapshot) => {
        const serverDate = snapshot.data()?.updatedAt?.toDate?.();
        if (!snapshot.metadata.hasPendingWrites && serverDate) {
          window.clearTimeout(timeoutId);
          unsubscribe();
          resolve(serverDate);
        }
      },
      (error) => {
        window.clearTimeout(timeoutId);
        unsubscribe();
        reject(error);
      }
    );
  });
}

async function syncServerClock() {
  if (!auth.currentUser) return;

  const clockRef = doc(db, "system_clock", auth.currentUser.uid);
  await setDoc(clockRef, { updatedAt: serverTimestamp() }, { merge: true });
  const serverDate = await waitForCommittedServerClock(clockRef);

  if (serverDate) {
    state.serverOffsetMs = serverDate.getTime() - Date.now();
    updateTodayMatch();
    updateResultsVisibility();
    renderLeaderboard();
    scheduleReminderNotification();
  }
}

async function ensureMatchDocs() {
  const writes = MATCHES.map(async (match) => {
    const matchRef = doc(db, "matches", match.id);
    const existing = await getDoc(matchRef);
    if (existing.exists()) return;

    return setDoc(matchRef, {
      id: match.id,
      matchNumber: match.matchNumber,
      date: match.date,
      teamA: match.teamA,
      teamB: match.teamB,
      venue: match.venue,
      cutoffAt: new Date(match.cutoffAt),
      seededFromStaticApp: true,
    });
  });

  await Promise.all(writes);
}

function listenTodayPrediction() {
  if (!state.playerKey || !state.todayMatch) return;

  const predictionRef = doc(
    db,
    "predictions",
    `${state.todayMatch.id}_${state.playerKey}`
  );

  const unsubscribe = onSnapshot(predictionRef, (snapshot) => {
    state.todayPrediction = snapshot.exists() ? snapshot.data() : null;
    renderPredictionSelection();
  });

  state.unsubscribers.push(unsubscribe);
}

function listenTodayPredictions() {
  if (!state.todayMatch) {
    state.todayPredictions = [];
    renderTodayPredictions();
    return;
  }

  const predictionsQuery = query(
    collection(db, "predictions"),
    where("matchId", "==", state.todayMatch.id)
  );

  const unsubscribe = onSnapshot(predictionsQuery, (snapshot) => {
    state.todayPredictions = snapshot.docs
      .map((docSnap) => docSnap.data())
      .sort((a, b) => a.userName.localeCompare(b.userName));
    renderTodayPredictions();
  });

  state.unsubscribers.push(unsubscribe);
}

function listenAllPredictionsAndResults() {
  const predictionsQuery = query(collection(db, "predictions"));
  const resultsQuery = query(collection(db, "results"));

  state.unsubscribers.push(
    onSnapshot(predictionsQuery, (snapshot) => {
      state.predictionsCache = snapshot.docs.map((docSnap) => docSnap.data());
      renderResultsSummary();
      renderLeaderboard();
    })
  );

  state.unsubscribers.push(
    onSnapshot(resultsQuery, (snapshot) => {
      state.resultsCache = snapshot.docs.map((docSnap) => docSnap.data());
      renderResultsSummary();
      renderLeaderboard();
    })
  );
}

function updateResultsVisibility() {
  const visible = isCutoffPassed(state.todayMatch);
  hide(els.resultsGuard, visible);
  hide(els.predictionsList, !visible);
}

function renderTodayPredictions() {
  updateResultsVisibility();

  const visible = isCutoffPassed(state.todayMatch);
  if (!visible) {
    renderPredictionChart([]);
    return;
  }

  if (!state.todayPredictions.length) {
    els.predictionsList.innerHTML = '<div class="info-box">No predictions submitted for this match yet.</div>';
    renderPredictionChart([]);
    return;
  }

  els.predictionsList.innerHTML = state.todayPredictions
    .map(
      (prediction) => `
        <div class="prediction-item selection-banner">
          <div>
            <strong>${prediction.userName}</strong>
            <span>${prediction.selectedTeam}</span>
          </div>
          <span>${prediction.updatedAt ? formatDateTime(prediction.updatedAt.toDate()) : "Pending timestamp"}</span>
        </div>
      `
    )
    .join("");

  renderPredictionChart(state.todayPredictions);
}

function renderPredictionChart(predictions) {
  const labels = state.todayMatch ? [state.todayMatch.teamA, state.todayMatch.teamB] : [];
  const counts = labels.map(
    (team) => predictions.filter((prediction) => prediction.selectedTeam === team).length
  );

  if (state.chart) {
    state.chart.destroy();
  }

  state.chart = new Chart(els.predictionChart, {
    type: "pie",
    data: {
      labels,
      datasets: [
        {
          data: counts,
          backgroundColor: ["#59f0c2", "#4f7cff"],
          borderColor: "#07111f",
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: "#f7fbff",
          },
        },
      },
    },
  });
}

function calculateLeaderboardRows() {
  const totals = APP_CONFIG.allowedUsers.reduce((acc, name) => {
    acc[name] = 0;
    return acc;
  }, {});

  state.resultsCache.forEach((result) => {
    const predictions = state.predictionsCache.filter(
      (prediction) => prediction.matchId === result.matchId
    );
    const winners = predictions.filter(
      (prediction) => prediction.selectedTeam === result.winner
    );

    if (!winners.length) return;

    const share = APP_CONFIG.poolPerMatch / winners.length;
    winners.forEach((winner) => {
      totals[winner.userName] = (totals[winner.userName] || 0) + share;
    });
  });

  return Object.entries(totals)
    .map(([userName, total]) => ({ userName, total }))
    .sort((a, b) => b.total - a.total || a.userName.localeCompare(b.userName));
}

function renderLeaderboard() {
  const rows = calculateLeaderboardRows();

  els.leaderboardList.innerHTML = rows
    .map(
      (row, index) => `
        <div class="leaderboard-item">
          <div>
            <strong>#${index + 1} ${row.userName}</strong>
            <span>Total winnings</span>
          </div>
          <div class="amount">${formatCurrency(row.total)}</div>
        </div>
      `
    )
    .join("");
}

function renderResultsSummary() {
  if (!state.resultsCache.length) {
    els.resultsSummary.innerHTML =
      '<div class="info-box">Add result documents in Firestore collection "results" to settle matches.</div>';
    return;
  }

  const items = state.resultsCache
    .slice()
    .sort((a, b) => a.matchId.localeCompare(b.matchId))
    .map((result) => {
      const match = MATCH_MAP[result.matchId];
      const predictions = state.predictionsCache.filter(
        (prediction) => prediction.matchId === result.matchId
      );
      const winners = predictions.filter(
        (prediction) => prediction.selectedTeam === result.winner
      );
      const share = winners.length ? APP_CONFIG.poolPerMatch / winners.length : 0;

      return `
        <div class="result-item">
          <div>
            <strong>${match ? `${match.teamA} vs ${match.teamB}` : result.matchId}</strong>
            <span>Winner: ${result.winner} • Winners: ${winners.length || 0}</span>
          </div>
          <div class="amount">${winners.length ? formatCurrency(share) : formatCurrency(0)}</div>
        </div>
      `;
    })
    .join("");

  els.resultsSummary.innerHTML = items;
}

async function submitPrediction(team) {
  const match = state.todayMatch;
  if (!match || !state.playerKey || !state.playerName) return;

  if (isCutoffPassed(match)) {
    showMessage(els.homeMessage, "Prediction window already closed for today.", false);
    return;
  }

  try {
    await setDoc(
      doc(db, "predictions", `${match.id}_${state.playerKey}`),
      {
        matchId: match.id,
        userKey: state.playerKey,
        userName: state.playerName,
        selectedTeam: team,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    showMessage(els.homeMessage, `Saved ${team} as your latest prediction.`, false);
  } catch (error) {
    showMessage(
      els.homeMessage,
      "Prediction failed. Check Firebase config and Firestore rules.",
      false
    );
    console.error(error);
  }
}

function scheduleReminderNotification() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (!state.todayMatch || isCutoffPassed(state.todayMatch)) return;

  const reminderAt =
    new Date(state.todayMatch.cutoffAt).getTime() -
    APP_CONFIG.notificationLeadMinutes * 60 * 1000;
  const delay = reminderAt - getServerNow().getTime();

  if (delay <= 0 || delay > 24 * 60 * 60 * 1000) return;

  window.clearTimeout(window.__iplReminderTimer);
  window.__iplReminderTimer = window.setTimeout(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const title = APP_CONFIG.appName;
    const body = "10 minutes left to submit prediction";

    if (registration) {
      registration.showNotification(title, { body, icon: "./icon.svg", badge: "./icon.svg" });
      return;
    }

    new Notification(title, { body });
  }, delay);
}

function setupTabs() {
  document.querySelectorAll(".nav-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const tabId = button.dataset.tab;
      document.querySelectorAll(".nav-btn").forEach((navButton) => {
        navButton.classList.toggle("active", navButton === button);
      });
      document.querySelectorAll(".tab-panel").forEach((panel) => {
        panel.classList.toggle("active", panel.id === tabId);
      });
    });
  });
}

function restorePlayer() {
  if (!state.playerKey || !allowedUserMap[state.playerKey]) {
    state.playerKey = "";
    state.playerName = "";
    localStorage.removeItem(STORAGE_KEYS.playerKey);
    localStorage.removeItem(STORAGE_KEYS.playerName);
    return false;
  }

  state.playerName = allowedUserMap[state.playerKey];
  els.playerBadge.textContent = state.playerName;
  hide(els.playerBadge, false);
  hide(els.logoutBtn, false);
  hide(els.loginModal, true);
  return true;
}

async function handleLogin(event) {
  event.preventDefault();
  const rawName = els.nameInput.value.trim();
  const playerKey = rawName.toLowerCase();
  const canonicalName = allowedUserMap[playerKey];

  if (!canonicalName) {
    showMessage(
      els.loginError,
      "Access denied. Only the 8 registered players are allowed.",
      false
    );
    return;
  }

  try {
    await signInAnonymously(auth);
    state.playerKey = playerKey;
    state.playerName = canonicalName;
    localStorage.setItem(STORAGE_KEYS.playerKey, playerKey);
    localStorage.setItem(STORAGE_KEYS.playerName, canonicalName);
    restorePlayer();
    await Notification.requestPermission();
    await bootstrapData();
  } catch (error) {
    showMessage(els.loginError, "Login failed. Check Firebase setup.", false);
    console.error(error);
  }
}

function handleLogout() {
  localStorage.removeItem(STORAGE_KEYS.playerKey);
  localStorage.removeItem(STORAGE_KEYS.playerName);
  window.location.reload();
}

async function bootstrapData() {
  clearSubscriptions();
  await ensureMatchDocs();
  await syncServerClock();
  updateTodayMatch();
  listenTodayPrediction();
  listenTodayPredictions();
  listenAllPredictionsAndResults();
  updateResultsVisibility();
  renderResultsSummary();
  renderLeaderboard();
}

async function init() {
  setupTabs();

  els.loginForm.addEventListener("submit", handleLogin);
  els.logoutBtn.addEventListener("click", handleLogout);
  els.teamABtn.addEventListener("click", () => submitPrediction(els.teamABtn.dataset.team));
  els.teamBBtn.addEventListener("click", () => submitPrediction(els.teamBBtn.dataset.team));

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.error("Service worker registration failed", error);
    });
  }

  window.setInterval(() => {
    refreshCountdown();
    renderPredictionSelection();
    updateResultsVisibility();
  }, 1000);

  window.setInterval(() => {
    syncServerClock().catch(console.error);
  }, 60 * 1000);

  if (!restorePlayer()) {
    hide(els.loginModal, false);
    return;
  }

  await signInAnonymously(auth);
  await bootstrapData();
}

init().catch((error) => {
  console.error(error);
  showMessage(els.homeMessage, "App failed to start. Check Firebase configuration.", false);
});
