/**
 * SubTracker backend — Google Apps Script Web App bound to the "SubTracker" Google Sheet.
 *
 * Setup (see README.md for click-by-click):
 *   1. Create a Google Sheet, open Extensions > Apps Script, paste this file in as Code.gs.
 *   2. Run setupSheet() once from the Apps Script editor (Run > Run function > setupSheet)
 *      to create the "Subscriptions" tab with the correct header row.
 *   3. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone with the link.
 *   4. Paste the resulting Web App URL into CONFIG.WEBAPP_URL in app.js.
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

function setupSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  sheet.getRange(1, 1, 1, HEADER_LABELS.length).setValues([HEADER_LABELS]);
  sheet.setFrozenRows(1);
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

    return jsonOutput_({ ok: false, error: `Unknown action: ${action}` });
  } catch (err) {
    return jsonOutput_({ ok: false, error: String(err) });
  }
}
