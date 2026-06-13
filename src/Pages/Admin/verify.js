import { useState } from "react";
import { supabase } from "../supabaseClient";

export default function Verify() {
  const [code, setCode] = useState("");
  const [result, setResult] = useState("");

  const verify = async () => {
    const { data } = await supabase
      .from("statements")
      .select("*")
      .eq("statement_hash", code)
      .single();

    if (data) {
      setResult("✅ VALID STATEMENT");
    } else {
      setResult("❌ INVALID STATEMENT");
    }
  };

  return (
    <div className="p-10">

      <h2 className="text-xl mb-4">Verify Statement</h2>

      <input
        placeholder="Enter verification code"
        onChange={(e) => setCode(e.target.value)}
        className="border p-2 mr-2"
      />

      <button onClick={verify} className="bg-blue-600 text-white px-4">
        Verify
      </button>

      <p className="mt-4 font-bold">{result}</p>
    </div>
  );
}