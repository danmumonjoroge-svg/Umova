// elimu/shared/services/fileStorage.js -- browser side of file storage. The database reserves every upload first (permission, type, size, quota);
// these helpers only move the bytes to the private 'elimu-files' bucket and ask for short-lived download links.
export const BUCKET = 'elimu-files';
export const fileSize = (n) => { const b = Number(n || 0); return b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`; };
export const fileExt = (name) => { const m = /\.([A-Za-z0-9]{1,6})$/.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; };
/** Quick check before asking the database (it repeats the same checks). cfg = { max_file_mb, allowed_ext }. Returns a problem text or ''. */
export function fileProblem(file, cfg = { max_file_mb: 10, allowed_ext: ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt', 'png', 'jpg', 'jpeg'] }) {
  if (!file) return 'Choose a file first.';
  if (!file.size) return 'That file is empty.';
  if (!cfg.allowed_ext.includes(fileExt(file.name))) return `This file type is not allowed. Allowed: ${cfg.allowed_ext.join(', ')}.`;
  if (file.size > cfg.max_file_mb * 1048576) return `That file is larger than ${cfg.max_file_mb} MB.`;
  return '';
}
export async function uploadFile(client, path, file) {
  const { error } = await client.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
  if (error) throw new Error(error.message || 'The upload failed. Check the connection and try again.');
}
export async function openFile(client, path, name) {
  const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, 120, { download: name || true });
  if (error || !data?.signedUrl) throw new Error('You cannot open this file, or it is no longer available.');
  window.open(data.signedUrl, '_blank', 'noopener');
}
