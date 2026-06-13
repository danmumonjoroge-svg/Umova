import { supabase } from "../supabaseClient";

export const uploadPDFToStorage = async (fileBlob, filePath) => {
  if (!fileBlob) throw new Error("No PDF provided");

  const { error } = await supabase.storage
    .from("documents")
    .upload(filePath, fileBlob, {
      contentType: "application/pdf",
      upsert: true
    });

  if (error) throw error;

  const { data } = supabase.storage
    .from("documents")
    .getPublicUrl(filePath);

  return data.publicUrl;
};