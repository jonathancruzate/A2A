// A2A SPREADSHEET binding doorbell — bound Apps Script for your A2A sheet.
// Install: in the sheet, Extensions > Apps Script, paste this into Code.gs,
// save, then Triggers > + Add Trigger:
//   function: onBridgeChange | source: From spreadsheet | type: On change
// Replace <YOUR_EMAIL> with the Google account your Gemini Spark watches.
//
// This script's ONLY job is the alert email. It never writes to the
// sheet, never creates or deletes triggers, and never polls or
// processes rows — all processing lives in the gemini-spark-a2a-spreadsheet
// skill, invoked by Gemini Spark's email-triggered schedule
// (gemini-spark-schedule-prompt.txt).
// The email is a doorbell, not a transport: it carries no request data.

function onBridgeChange(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const requestsSheet = ss.getSheetByName("Requests");
  if (!requestsSheet) return;

  // Check if there are data rows below the header row
  const lastRow = requestsSheet.getLastRow();
  if (lastRow <= 1) return;

  // 15-second debounce to avoid duplicate alerts during batch row inserts
  const cache = CacheService.getScriptCache();
  if (cache.get("RECENT_ALERT")) return;
  cache.put("RECENT_ALERT", "true", 15);

  MailApp.sendEmail({
    to: "<YOUR_EMAIL>",
    subject: "A2A-Event",
    body: "A new pending request was appended to the Requests tab of your A2A sheet."
  });
}
