import React, { useEffect, useState } from "react";
import {
  createStory,
  updateStory,
  deleteStory,
} from "../../services/storyService";

import { supabase } from "../../supabaseClient";
import "./StoryDashboard.css";

export default function StoryDashboard() {
  const [stories, setStories] = useState([]);

  const [form, setForm] = useState({
    id: null,
    name: "",
    title: "",
    story: "",
  });

  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);

  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(false);

  /* ================= FETCH ================= */
  const fetchStories = async () => {
    const { data, error } = await supabase
      .from("member_stories")
      .select("*")
      .order("created_at", { ascending: false });

    if (!error) setStories(data || []);
  };

  useEffect(() => {
    fetchStories();
  }, []);

  /* ================= INPUT ================= */
  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleFile = (e) => {
    const f = e.target.files[0];
    setFile(f);

    if (f) {
      setPreview(URL.createObjectURL(f));
    }
  };

  /* ================= RESET ================= */
  const reset = () => {
    setForm({ id: null, name: "", title: "", story: "" });
    setFile(null);
    setPreview(null);
    setEditMode(false);
  };

  /* ================= CREATE ================= */
  const handleCreate = async () => {
    try {
      setLoading(true);

      await createStory({
        file,
        name: form.name,
        title: form.title,
        story: form.story,
      });

      await fetchStories();
      reset();
    } catch (err) {
      alert("CREATE FAILED: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  /* ================= EDIT ================= */
  const startEdit = (s) => {
    setForm({
      id: s.id,
      name: s.name,
      title: s.title,
      story: s.story,
    });

    setPreview(s.image_url);
    setEditMode(true);
  };

  /* ================= UPDATE ================= */
  const handleUpdate = async () => {
    try {
      setLoading(true);

      await updateStory({
        id: form.id,
        file,
        name: form.name,
        title: form.title,
        story: form.story,
        existingImage: stories.find((s) => s.id === form.id)?.image_url,
      });

      await fetchStories();
      reset();
    } catch (err) {
      alert("UPDATE FAILED: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  /* ================= DELETE ================= */
  const handleDelete = async (id) => {
    if (!window.confirm("Delete this story permanently?")) return;

    await deleteStory(id);
    fetchStories();
  };

  return (
    <div className="story-dashboard">

      {/* ================= HEADER ================= */}
      <div className="dashboard-header">
        <h2>📊 Member Stories CMS</h2>
        <p>Bank-grade content management system</p>

        <span className={editMode ? "badge edit" : "badge create"}>
          {editMode ? "EDIT MODE" : "CREATE MODE"}
        </span>
      </div>

      {/* ================= FORM PANEL ================= */}
      <div className="form-card">

        <div className="form-grid">

          <input
            name="name"
            placeholder="Member Name"
            value={form.name}
            onChange={handleChange}
          />

          <input
            name="title"
            placeholder="Story Title"
            value={form.title}
            onChange={handleChange}
          />

          <textarea
            name="story"
            placeholder="Member success story..."
            value={form.story}
            onChange={handleChange}
          />

          <input type="file" onChange={handleFile} />

        </div>

        {preview && (
          <div className="image-preview">
            <img src={preview} alt="preview" />
          </div>
        )}

        <div className="btn-row">

          {!editMode ? (
            <button onClick={handleCreate} disabled={loading}>
              {loading ? "Creating..." : "➕ Create Story"}
            </button>
          ) : (
            <>
              <button onClick={handleUpdate} disabled={loading}>
                {loading ? "Updating..." : "💾 Update Story"}
              </button>

              <button className="cancel" onClick={reset}>
                Cancel
              </button>
            </>
          )}

        </div>

      </div>

      {/* ================= STORIES GRID ================= */}
      <div className="stories-grid">

        {stories.length === 0 ? (
          <div className="empty">No stories available yet</div>
        ) : (
          stories.map((s) => (
            <div className="story-card" key={s.id}>

              <img src={s.image_url} alt="" />

              <div className="story-body">
                <h4>{s.name}</h4>
                <span className="title">{s.title}</span>
                <p>{s.story?.slice(0, 90)}...</p>
              </div>

              <div className="story-actions">

                <button onClick={() => startEdit(s)}>
                  ✏️ Edit
                </button>

                <button
                  className="danger"
                  onClick={() => handleDelete(s.id)}
                >
                  🗑 Delete
                </button>

              </div>

            </div>
          ))
        )}

      </div>

    </div>
  );
}