import { supabase } from "../supabaseClient";

/* =========================
   UPLOAD IMAGE (SAFE)
========================= */
const uploadImage = async (file) => {
  if (!file) return null;

  const fileName = `${Date.now()}-${file.name}`;

  const { data, error } = await supabase.storage
    .from("stories")
    .upload(fileName, file);

  if (error) {
    console.error("STORAGE ERROR:", error);
    throw new Error(error.message);
  }

  const { data: publicUrl } = supabase.storage
    .from("stories")
    .getPublicUrl(fileName);

  return publicUrl.publicUrl;
};

/* =========================
   CREATE STORY (FIXED)
========================= */
export const createStory = async ({ file, name, title, story }) => {
  try {
    console.log("CREATING STORY...");

    const image_url = await uploadImage(file);

    const payload = {
      name,
      title,
      story,
      image_url,
    };

    console.log("INSERT PAYLOAD:", payload);

    const { data, error } = await supabase
      .from("member_stories")
      .insert([payload])
      .select();

    if (error) {
      console.error("INSERT ERROR FULL:", error);
      throw new Error(error.message);
    }

    console.log("CREATED SUCCESS:", data);

    return data;
  } catch (err) {
    console.error("CREATE STORY FAILED:", err.message);
    throw err;
  }
};

/* =========================
   UPDATE STORY
========================= */
export const updateStory = async ({
  id,
  file,
  name,
  title,
  story,
  existingImage,
}) => {
  let image_url = existingImage;

  if (file) {
    image_url = await uploadImage(file);
  }

  const { data, error } = await supabase
    .from("member_stories")
    .update({
      name,
      title,
      story,
      image_url,
    })
    .eq("id", id)
    .select();

  if (error) {
    console.error("UPDATE ERROR:", error);
    throw new Error(error.message);
  }

  return data;
};

/* =========================
   DELETE STORY
========================= */
export const deleteStory = async (id) => {
  const { error } = await supabase
    .from("member_stories")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("DELETE ERROR:", error);
    throw new Error(error.message);
  }
};