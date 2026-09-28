export async function batchReview({ templates, currentId, mappings, openAndSave, confirm, onProgress, onConfirmed }) {
  const pending = templates.filter(t => !t.reviewed);
  pending.sort((a, b) => Number(b.id === currentId) - Number(a.id === currentId));
  const savedMappings = { ...mappings };
  let completed = 0;
  for (const template of pending) {
    onProgress(completed + 1, pending.length, template);
    try {
      const versionId = await openAndSave(template);
      const state = await confirm(template, {
        version_id: versionId,
        mappings: Object.fromEntries(template.fields.map(f => [f.tag, savedMappings[f.tag] || ""])),
      });
      completed++;
      onConfirmed(state);
    } catch (error) {
      throw new Error(`已确认 ${completed}/${pending.length} 份；“${template.title}”未完成：${error.message}。已完成的审核保留，可再次点击继续。`);
    }
  }
  return completed;
}
