/**
 * SubTracker backend — Google Apps Script Web App bound to the "SubTracker" Google Sheet.
 *
 * Setup (see README.md for click-by-click):
 *   1. Create a Google Sheet, open Extensions > Apps Script, paste this file in as Code.gs.
 *   2. Run setupSheet() once from the Apps Script editor (Run > Run function > setupSheet)
 *      to create the "Subscriptions" tab with the correct header row and formatting.
 *      (Already have the tab? Run formatSheet() instead — it's safe to re-run any time.)
 *   3. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone with the link.
 *   4. Paste the resulting Web App URL into CONFIG.WEBAPP_URL in app.js.
 *
 * Push notifications (Firebase Cloud Messaging) — see README.md for the full
 * Firebase console setup. Once you've generated a service account key there,
 * add three Script Properties here (gear icon > Project Settings > Script
 * Properties): FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY (paste the
 * private_key value exactly as it appears in the downloaded JSON, including
 * the literal \n sequences — normalizePrivateKey_ below converts them back
 * to real newlines). Then add a time-driven trigger (clock icon > Add
 * trigger) calling sendReminders(), Day timer, whatever time you like.
 */

const SHEET_NAME = 'Subscriptions';

// Canonical column order. Row objects sent to/from the client use these exact keys.
const COLUMNS = [
  'id',
  'vendor',
  'planNotes',
  'cost',
  'billingCycle',
  'keyDate',
  'autoRenews',
  'intendedAction',
  'status',
  'lastUpdated',
];

const HEADER_LABELS = [
  'ID',
  'Vendor',
  'Plan/Notes',
  'Cost',
  'Billing cycle',
  'Key date',
  'Auto-renews?',
  'Intended action',
  'Status',
  'Last updated',
];

const PUSH_SHEET_NAME = 'PushTokens';
const PUSH_HEADER_LABELS = ['Token', 'Added'];

function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  sheet.getRange(1, 1, 1, HEADER_LABELS.length).setValues([HEADER_LABELS]);
  sheet.setFrozenRows(1);
  formatSheet();
  ensurePushSheet_();
}

// Run this once (Run > Run function > formatSheet) any time you want to
// re-apply the styling — e.g. after setupSheet() on a fresh sheet, or if
// you've manually messed with the formatting and want to reset it.
function formatSheet() {
  const sheet = getSheet_();
  const numCols = HEADER_LABELS.length;

  // Header row: bold white text on a dark blue band, matching the app's theme.
  const header = sheet.getRange(1, 1, 1, numCols);
  header
    .setBackground('#1f2a44')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setVerticalAlignment('middle');
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 32);

  // Column widths tuned per field; ID is hidden — the app needs it to match
  // rows for edit/delete, but it's just visual clutter for you.
  const widths = {
    id: 40,
    vendor: 160,
    planNotes: 220,
    cost: 80,
    billingCycle: 110,
    keyDate: 100,
    autoRenews: 100,
    intendedAction: 120,
    status: 100,
    lastUpdated: 160,
  };
  COLUMNS.forEach((key, i) => sheet.setColumnWidth(i + 1, widths[key]));
  sheet.hideColumns(1);

  const lastRow = Math.max(sheet.getLastRow(), 2);
  const dataRange = sheet.getRange(2, 1, lastRow - 1, numCols);

  // Clear old banding/formatting before reapplying, so this is safe to re-run.
  sheet.getBandings().forEach((b) => b.remove());
  sheet.getRange(1, 1, sheet.getMaxRows(), numCols).setBackground(null);
  header.setBackground('#1f2a44');
  dataRange.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);

  const statusCol = COLUMNS.indexOf('status') + 1;
  const keyDateCol = COLUMNS.indexOf('keyDate') + 1;
  const statusRange = sheet.getRange(2, statusCol, sheet.getMaxRows() - 1, 1);
  const keyDateRange = sheet.getRange(2, keyDateCol, sheet.getMaxRows() - 1, 1);

  const rules = [
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('active')
      .setBackground('#d9f2e3')
      .setFontColor('#1e6b40')
      .setRanges([statusRange])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('cancelled')
      .setBackground('#eceff4')
      .setFontColor('#5b6472')
      .setRanges([statusRange])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('expired')
      .setBackground('#fbe0e0')
      .setFontColor('#a13636')
      .setRanges([statusRange])
      .build(),
    // Key date due within 7 days (and not in the past) — amber highlight,
    // mirroring the app's own "due soon" badge.
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(
        `=AND(${keyDateRange.getA1Notation().split(':')[0]}<>"", ${keyDateRange.getA1Notation().split(':')[0]}-TODAY()>=0, ${keyDateRange.getA1Notation().split(':')[0]}-TODAY()<=7)`
      )
      .setBackground('#fdf0d5')
      .setFontColor('#8a5a00')
      .setRanges([keyDateRange])
      .build(),
  ];
  sheet.setConditionalFormatRules(rules);
}

function ensurePushSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(PUSH_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(PUSH_SHEET_NAME);
    sheet.getRange(1, 1, 1, PUSH_HEADER_LABELS.length).setValues([PUSH_HEADER_LABELS]);
    sheet.getRange(1, 1, 1, PUSH_HEADER_LABELS.length).setFontWeight('bold').setBackground('#1f2a44').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getAllTokens_() {
  const sheet = ensurePushSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet
    .getRange(2, 1, lastRow - 1, 1)
    .getValues()
    .map((r) => r[0])
    .filter(Boolean);
}

function addTokenIfNew_(token) {
  const sheet = ensurePushSheet_();
  if (getAllTokens_().indexOf(token) !== -1) return;
  sheet.appendRow([token, new Date().toISOString()]);
}

function removeTokenRow_(token) {
  const sheet = ensurePushSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === token) {
      sheet.deleteRow(i + 2);
      return;
    }
  }
}

function getSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${SHEET_NAME}" not found — run setupSheet() once first.`);
  return sheet;
}

function rowToRecord_(row) {
  const record = {};
  COLUMNS.forEach((key, i) => {
    record[key] = row[i] === undefined || row[i] === '' ? '' : row[i];
  });
  if (record.keyDate instanceof Date) {
    record.keyDate = Utilities.formatDate(record.keyDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  if (record.lastUpdated instanceof Date) {
    record.lastUpdated = record.lastUpdated.toISOString();
  }
  return record;
}

function recordToRow_(record) {
  return COLUMNS.map((key) => (record[key] === undefined ? '' : record[key]));
}

function readAllRecords_() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, COLUMNS.length).getValues();
  return values
    .map((row, i) => ({ record: rowToRecord_(row), sheetRow: i + 2 }))
    .filter((entry) => entry.record.id !== '')
    .map((entry) => entry.record);
}

function findRowById_(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2; // 1-indexed sheet row
  }
  return -1;
}

function jsonOutput_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    const subscriptions = readAllRecords_();
    return jsonOutput_({ subscriptions });
  } catch (err) {
    return jsonOutput_({ error: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    const sheet = getSheet_();

    if (action === 'add') {
      const now = new Date().toISOString();
      const record = {
        id: Utilities.getUuid(),
        vendor: body.vendor || '',
        planNotes: body.planNotes || '',
        cost: body.cost || 0,
        billingCycle: body.billingCycle || 'monthly',
        keyDate: body.keyDate || '',
        autoRenews: body.autoRenews || 'yes',
        intendedAction: body.intendedAction || 'undecided',
        status: body.status || 'active',
        lastUpdated: now,
      };
      sheet.appendRow(recordToRow_(record));
      return jsonOutput_({ ok: true, subscription: record });
    }

    if (action === 'edit') {
      const row = findRowById_(sheet, body.id);
      if (row === -1) return jsonOutput_({ ok: false, error: 'Subscription not found' });
      const record = {
        id: body.id,
        vendor: body.vendor || '',
        planNotes: body.planNotes || '',
        cost: body.cost || 0,
        billingCycle: body.billingCycle || 'monthly',
        keyDate: body.keyDate || '',
        autoRenews: body.autoRenews || 'yes',
        intendedAction: body.intendedAction || 'undecided',
        status: body.status || 'active',
        lastUpdated: new Date().toISOString(),
      };
      sheet.getRange(row, 1, 1, COLUMNS.length).setValues([recordToRow_(record)]);
      return jsonOutput_({ ok: true, subscription: record });
    }

    if (action === 'delete') {
      const row = findRowById_(sheet, body.id);
      if (row === -1) return jsonOutput_({ ok: false, error: 'Subscription not found' });
      sheet.deleteRow(row);
      return jsonOutput_({ ok: true, id: body.id });
    }

    if (action === 'subscribeFcm') {
      if (!body.token) return jsonOutput_({ ok: false, error: 'Missing token' });
      addTokenIfNew_(body.token);
      return jsonOutput_({ ok: true });
    }

    return jsonOutput_({ ok: false, error: `Unknown action: ${action}` });
  } catch (err) {
    return jsonOutput_({ ok: false, error: String(err) });
  }
}

// ---------------------------------------------------------------------------
// Push notifications (Firebase Cloud Messaging)
// ---------------------------------------------------------------------------

function daysUntil_(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.round((target - today) / 86400000);
}

function buildReminderMessage_(sub) {
  const date = Utilities.formatDate(new Date(sub.keyDate + 'T00:00:00'), Session.getScriptTimeZone(), 'MMM d, yyyy');
  return sub.autoRenews === 'yes'
    ? `Cancel by ${date} to avoid being charged for ${sub.vendor}.`
    : `Renew by ${date} or you'll lose access to ${sub.vendor}.`;
}

function normalizePrivateKey_(key) {
  return key.replace(/\\n/g, '\n');
}

function getServiceAccountAccessToken_() {
  const props = PropertiesService.getScriptProperties();
  const clientEmail = props.getProperty('FCM_CLIENT_EMAIL');
  const privateKey = normalizePrivateKey_(props.getProperty('FCM_PRIVATE_KEY') || '');
  if (!clientEmail || !privateKey) {
    throw new Error('Missing FCM_CLIENT_EMAIL / FCM_PRIVATE_KEY script properties — see the setup notes at the top of this file.');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const toBase64Url = (obj) =>
    Utilities.base64EncodeWebSafe(JSON.stringify(obj), Utilities.Charset.UTF_8).replace(/=+$/, '');
  const signingInput = toBase64Url(header) + '.' + toBase64Url(claimSet);
  const signatureBytes = Utilities.computeRsaSha256Signature(signingInput, privateKey);
  const signature = Utilities.base64EncodeWebSafe(signatureBytes).replace(/=+$/, '');
  const jwt = signingInput + '.' + signature;

  const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    },
    muteHttpExceptions: true,
  });

  const data = JSON.parse(response.getContentText());
  if (!data.access_token) throw new Error('Failed to get FCM access token: ' + response.getContentText());
  return data.access_token;
}

function sendFcmMessageWithToken_(accessToken, token, title, body) {
  const projectId = PropertiesService.getScriptProperties().getProperty('FCM_PROJECT_ID');
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  const payload = {
    message: {
      token: token,
      notification: { title: title, body: body },
    },
  };
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + accessToken },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  return { code: response.getResponseCode(), body: response.getContentText() };
}

// Time-driven trigger target — add via the Apps Script editor's clock icon
// (Triggers > Add trigger > sendReminders > Time-driven > Day timer).
function sendReminders() {
  const tokens = getAllTokens_();
  if (tokens.length === 0) return;

  const dueSubs = readAllRecords_().filter((sub) => {
    if (sub.status !== 'active' || !sub.keyDate) return false;
    const days = daysUntil_(sub.keyDate);
    return days === 7 || days === 1;
  });
  if (dueSubs.length === 0) return;

  const accessToken = getServiceAccountAccessToken_();
  dueSubs.forEach((sub) => {
    const message = buildReminderMessage_(sub);
    tokens.forEach((token) => {
      const result = sendFcmMessageWithToken_(accessToken, token, 'SubTracker', message);
      if (result.code === 404 || /UNREGISTERED|NOT_FOUND/.test(result.body)) {
        removeTokenRow_(token);
      }
    });
  });
}

// Run manually (Run > Run function > sendTestPush) to smoke-test delivery
// to every currently-stored device, ignoring key-date logic entirely.
function sendTestPush() {
  const tokens = getAllTokens_();
  if (tokens.length === 0) {
    Logger.log('No push tokens stored yet — enable notifications in the app first.');
    return;
  }
  const accessToken = getServiceAccountAccessToken_();
  tokens.forEach((token) => {
    const result = sendFcmMessageWithToken_(accessToken, token, 'SubTracker test', 'If you see this, push notifications are working.');
    Logger.log(result);
  });
}
