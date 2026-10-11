import { API_BASE_URL, CITIES } from "./config.js";

const TOKEN_KEY = "sessionToken";
let pendingSession = null;

async function request(method, path, body, token) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return null;

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed with status ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function sessionToken() {
  pendingSession ??= (async () => {
    const stored = await chrome.storage.local.get(TOKEN_KEY);
    if (stored[TOKEN_KEY]) return stored[TOKEN_KEY];
    const { token } = await request("POST", "/sessions");
    await chrome.storage.local.set({ [TOKEN_KEY]: token });
    return token;
  })();
  try { return await pendingSession; }
  finally { pendingSession = null; }
}

async function callApi({ method, path, body, auth }) {
  const token = auth ? await sessionToken() : undefined;
  try {
    return await request(method, path, body, token);
  } catch (error) {
    // The server no longer knows this token, so drop it. The next call starts a new session.
    if (auth && error.status === 401) await chrome.storage.local.remove(TOKEN_KEY);
    throw error;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;

  if (message.type === "config") {
    sendResponse({ ok: true, data: { cities: CITIES } });
    return false;
  }
  if (message.type === "openDashboard") {
    const tab = ["overview", "actions", "comparisons", "progress"].includes(message.tab) ? `?tab=${message.tab}` : "";
    chrome.tabs.create({ url: chrome.runtime.getURL(`ui/dashboard.html${tab}`) });
    return false;
  }
  if (message.type === "api") {
    callApi(message)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  return false;
});
