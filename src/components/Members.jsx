import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { useNavigate } from "react-router-dom";

export default function Members() {
  const [members, setMembers] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    fetchMembers();
  }, []);

  async function fetchMembers() {
    const { data } = await supabase.from("members").select("*");
    setMembers(data || []);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Members</h1>
      <table className="min-w-full table-auto bg-white rounded-xl shadow">
        <thead className="bg-gray-200">
          <tr>
            <th className="p-3 text-left">Name</th>
            <th className="p-3 text-left">Phone</th>
            <th className="p-3 text-left">Member ID</th>
          </tr>
        </thead>
        <tbody>
          {members.map(m => (
            <tr
              key={m.id}
              className="cursor-pointer border-b hover:bg-gray-100"
              onClick={() => navigate(`/members/${m.id}`)}
            >
              <td className="p-3">{m.name}</td>
              <td className="p-3">{m.phone}</td>
              <td className="p-3">{m.id}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}