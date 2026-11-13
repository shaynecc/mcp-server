// MCP Apps defines inline/fullscreen/pip; the host decides where its expanded viewer appears.
// Request expansion once per resource, so returning to the conversation is respected.
export function qualificationDisplayPreference(app) {
  let attempted = false;
  return async ({ ready, supported, toolResult }) => {
    const initial = toolResult?.structuredContent;
    if (attempted || !ready || !supported || initial?.form !== 'qualification' || initial.mode !== 'input') return;
    attempted = true;
    const context = app.getHostContext();
    if (context?.displayMode === 'fullscreen' || !context?.availableDisplayModes?.includes('fullscreen')) return;
    try {
      await app.requestDisplayMode({ mode: 'fullscreen' });
    } catch {
      // Display preference is optional; a host rejection does not interrupt the form.
    }
  };
}
