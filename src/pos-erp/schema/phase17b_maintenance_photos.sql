-- phase17b — private storage bucket for maintenance photos. Run after phase17 (separate file: it touches the storage schema).
-- Same pattern as phase15_business_logo.sql, but PRIVATE (repair photos can show a tenant's home): files are read through short-lived signed URLs.
-- Path shape: <business_id>/<maintenance_request_id>/<uuid>-<filename>
INSERT INTO storage.buckets (id, name, public) VALUES ('maintenance-photos', 'maintenance-photos', false) ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS maint_photos_select ON storage.objects;
CREATE POLICY maint_photos_select ON storage.objects FOR SELECT USING (
  bucket_id = 'maintenance-photos' AND (storage.foldername(name))[1] IN (SELECT id::text FROM lb_businesses WHERE tenant_id = get_current_tenant_id()));
DROP POLICY IF EXISTS maint_photos_insert ON storage.objects;
CREATE POLICY maint_photos_insert ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'maintenance-photos' AND (storage.foldername(name))[1] IN (SELECT id::text FROM lb_businesses WHERE tenant_id = get_current_tenant_id()));
DROP POLICY IF EXISTS maint_photos_delete ON storage.objects;
CREATE POLICY maint_photos_delete ON storage.objects FOR DELETE USING (
  bucket_id = 'maintenance-photos' AND (storage.foldername(name))[1] IN (SELECT id::text FROM lb_businesses WHERE tenant_id = get_current_tenant_id()));
