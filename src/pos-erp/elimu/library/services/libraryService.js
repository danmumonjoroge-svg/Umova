// elimu/library/services/libraryService.js -- e-library (elimu_1013). Files use the shared storage rules (elimu_1011).
import { rpc } from '../../shared/services/elimuDb';
import { posSupabase } from '../../../services/posSupabaseClient';
import { uploadFile, openFile } from '../../shared/services/fileStorage.js';

export const LIB_CATEGORIES = [['PAST_PAPER', 'Past papers'], ['REVISION_BOOK', 'Revision books'], ['REFERENCE', 'Reference'], ['SCHOOL_DOCUMENT', 'School documents'], ['OTHER', 'Other']];
export const LIB_LABEL = Object.fromEntries(LIB_CATEGORIES);
export const libraryService = {
  list: ({ category, search } = {}) => rpc('elimu_library_list', { p_category: category || null, p_class: null, p_subject: null, p_search: search || null }),
  remove: (id, reason) => rpc('elimu_library_remove', { p_item: id, p_reason: reason || null }),
  async add({ scope, title, description, category, file }) {
    const r = await rpc('elimu_library_prepare', { p_title: title, p_description: description || null, p_category: category, p_class: scope.class_id || null, p_subject: scope.subject_id || null, p_file_name: file.name, p_mime: file.type || null, p_size: file.size });
    await uploadFile(posSupabase, r.path, file);
    return rpc('elimu_library_confirm', { p_item: r.item_id });
  },
  open: (path, name) => openFile(posSupabase, path, name),
};
