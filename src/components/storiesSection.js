import React, { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import "./StoriesSection.css";

export default function StoriesSection() {
  const [stories, setStories] = useState([]);
  const [selected, setSelected] = useState(null);

  // ================= FETCH STORIES =================
  const fetchStories = async () => {
    const { data, error } = await supabase
      .from("member_stories")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Stories fetch error:", error);
      return;
    }

    setStories(data || []);
  };

  useEffect(() => {
    fetchStories();
  }, []);

  return (
    <section className="stories-section">

      {/* HEADER */}
      <div className="stories-header">
        <h2>What Our Members Say</h2>
        <p>Real financial success stories from our community</p>
      </div>

      {/* HORIZONTAL SCROLL CAROUSEL */}
      <div className="stories-scroll">

        {stories.map((story) => (
          <div
            key={story.id}
            className="story-card"
            onClick={() => setSelected(story)}
          >

            <img src={story.image_url} alt={story.name} />

            <div className="story-content">
              <h3>{story.name}</h3>
              <span>{story.title}</span>

              <p>
                {story.story.length > 110
                  ? story.story.substring(0, 110) + "..."
                  : story.story}
              </p>
            </div>

          </div>
        ))}

      </div>

      {/* MODAL FULL STORY */}
      {selected && (
        <div className="story-modal" onClick={() => setSelected(null)}>

          <div
            className="story-modal-box"
            onClick={(e) => e.stopPropagation()}
          >

            <img src={selected.image_url} alt={selected.name} />

            <h2>{selected.name}</h2>
            <h4>{selected.title}</h4>

            <p>{selected.story}</p>

            <button onClick={() => setSelected(null)}>
              Close
            </button>

          </div>

        </div>
      )}

    </section>
  );
}