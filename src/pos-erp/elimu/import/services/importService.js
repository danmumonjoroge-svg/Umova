// elimu/import/services/importService.js -- wrappers over elimu_1004_import.sql. The database checks every row and decides what may be saved.
import { rpc } from '../../shared/services/elimuDb';

export const importService = {
  stage: ({ fileName, yearId, rows }) => rpc('elimu_import_stage', { p_file_name: fileName || null, p_year: yearId, p_rows: rows }),
  rows: (batchId, status = null, limit = 200, offset = 0) => rpc('elimu_import_rows_list', { p_batch: batchId, p_status: status, p_limit: limit, p_offset: offset }),
  commit: (batchId) => rpc('elimu_import_commit', { p_batch: batchId }),
  discard: (batchId) => rpc('elimu_import_discard', { p_batch: batchId }),
  stageBalances: ({ fileName, asOf, rows }) => rpc('elimu_import_balances_stage', { p_file_name: fileName || null, p_as_of: asOf, p_rows: rows }),
  commitBalances: (batchId) => rpc('elimu_import_balances_commit', { p_batch: batchId }),
  stageResults: ({ fileName, rows }) => rpc('elimu_import_results_stage', { p_file_name: fileName || null, p_rows: rows }),
  commitResults: (batchId) => rpc('elimu_import_results_commit', { p_batch: batchId }),
  batches: () => rpc('elimu_import_batches_list', {}),
};
