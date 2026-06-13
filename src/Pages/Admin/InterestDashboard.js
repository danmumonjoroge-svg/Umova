import { useState } from "react";

export default function InterestEnginePanel() {

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const runInterestEngine = async () => {

    setLoading(true);
    setResult(null);
    setError(null);

    try {

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/calculate-loan-interest`,
        {
          method: "POST",
          headers: {
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
            "Content-Type": "application/json"
          }
        }
      );

      const text = await res.text();

      if (!res.ok) {
        throw new Error(text);
      }

      setResult(text);

    } catch (err) {
      setError(err.message || "Something went wrong");
    }

    setLoading(false);
  };

  return (
    <div className="bg-white p-5 rounded-xl shadow border">

      {/* HEADER */}
      <div className="mb-4">
        <h2 className="text-lg font-bold text-gray-800">
          Interest Engine Control Panel
        </h2>
        <p className="text-sm text-gray-500">
          Run monthly loan interest posting (ERP Core Function)
        </p>
      </div>

      {/* BUTTON */}
      <button
        onClick={runInterestEngine}
        disabled={loading}
        className={`px-5 py-2 rounded text-white font-semibold transition
          ${loading ? "bg-gray-400" : "bg-purple-600 hover:bg-purple-700"}
        `}
      >
        {loading ? "Processing Interest..." : "Run Interest Engine"}
      </button>

      {/* STATUS AREA */}
      <div className="mt-4 space-y-3">

        {/* SUCCESS */}
        {result && (
          <div className="bg-green-50 border border-green-200 text-green-700 p-3 rounded">
            <p className="font-semibold">Success</p>
            <pre className="text-xs mt-1 whitespace-pre-wrap">
              {result}
            </pre>
          </div>
        )}

        {/* ERROR */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded">
            <p className="font-semibold">Error</p>
            <p className="text-sm">{error}</p>
          </div>
        )}

      </div>

    </div>
  );
}