// elimu/materials/services/materialService.js -- study materials (elimu_1011). The database decides who may post (allocated teachers) and who may read.
import { rpc } from '../../shared/services/elimuDb';
import { posSupabase } from '../../../services/posSupabaseClient';
import { uploadFile, openFile } from '../../shared/services/fileStorage.js';

export const CATEGORIES = [['NOTES', 'Notes'], ['REVISION', 'Revision'], ['PAST_PAPER', 'Past paper'], ['OTHER', 'Other']];
export const CATEGORY_LABEL = Object.fromEntries(CATEGORIES);
export const materialService = {
  scopes: () => rpc('elimu_material_scopes'),
  list: (classId, subjectId) => rpc('elimu_material_list', { p_class: classId || null, p_subject: subjectId || null }),
  remove: (id, reason) => rpc('elimu_material_remove', { p_material: id, p_reason: reason || null }),
  storageLimits: () => rpc('elimu_storage_get').catch(() => null),
  /** reserve -> upload -> confirm. If the upload fails the reserved row simply stays hidden (PENDING). */
  async post({ scope, title, category, description, file }) {
    const r = await rpc('elimu_material_prepare', { p_class: scope.class_id, p_stream: scope.stream_id || null, p_subject: scope.subject_id, p_title: title, p_category: category, p_description: description || null, p_file_name: file.name, p_mime: file.type || null, p_size: file.size });
    await uploadFile(posSupabase, r.path, file);
    return rpc('elimu_material_confirm', { p_material: r.material_id });
  },
  open: (path, name) => openFile(posSupabase, path, name),
};
