import { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from "../../supabaseClient";

export default function JournalList() {
  const [journal, setJournal] = useState([]);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selectedRows, setSelectedRows] = useState([]);

  const PAGE_SIZE = 15;

  const format = (v) =>
    Number(v || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const loadJournal = useCallback(async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("general_ledger")
      .select("*")
      .order("date", { ascending: false });

    setLoading(false);

    if (error) return alert(error.message);
    setJournal(data || []);
  }, []);

  useEffect(() => {
    loadJournal();
  }, [loadJournal]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();

    return journal.filter((j) =>
      `${j.description || ""} ${j.member_no || ""} ${j.reference || ""}`
        .toLowerCase()
        .includes(q)
    );
  }, [journal, search]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  const paginated = useMemo(() => {
    return filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  }, [filtered, page]);

  const toggleSelect = (id) => {
    setSelectedRows((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id]
    );
  };

  const selectAllVisible = () => {
    const ids = paginated.map((j) => j.id);
    const allSelected = ids.every((id) => selectedRows.includes(id));

    if (allSelected) {
      setSelectedRows((prev) => prev.filter((id) => !ids.includes(id)));
    } else {
      setSelectedRows((prev) => [...new Set([...prev, ...ids])]);
    }
  };

  const exportCSV = () => {
    const rows = [
      [
        "Date",
        "Reference",
        "Member",
        "Description",
        "Debit",
        "Credit",
        "Amount",
      ],
    ];

    const source =
      selectedRows.length > 0
        ? filtered.filter((j) => selectedRows.includes(j.id))
        : filtered;

    source.forEach((j) => {
      rows.push([
        j.date,
        j.reference,
        j.member_no,
        j.description,
        j.debit_account_id,
        j.credit_account_id,
        j.amount,
      ]);
    });

    const csv = rows.map((r) => r.join(",")).join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `journal_export_${Date.now()}.csv`;
    a.click();

    URL.revokeObjectURL(url);
  };

  const printView = () => {
    window.print();
  };

  const refresh = async () => {
    await loadJournal();
    setPage(1);
    setSelectedRows([]);
  };

  return (
    <div className="p-5 bg-white rounded-xl shadow-lg">

      {/* HEADER */}
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-bold">📘 Advanced Journal Engine</h2>

        <div className="flex gap-2">
          <button onClick={refresh} className="bg-blue-600 text-white px-3 py-1 rounded">
            🔄 Refresh
          </button>

          <button onClick={exportCSV} className="bg-green-600 text-white px-3 py-1 rounded">
            ⬇ Export CSV
          </button>

          <button onClick={printView} className="bg-gray-700 text-white px-3 py-1 rounded">
            🖨 Print
          </button>
        </div>
      </div>

      {/* SEARCH */}
      <input
        className="w-full border p-2 rounded mb-3"
        placeholder="Search reference, member, description..."
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
      />

      {/* LOADING */}
      {loading && <p className="text-sm text-gray-500 mb-2">Loading...</p>}

      {/* TABLE */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border">

          <thead className="bg-gray-100">
            <tr>
              <th className="p-2">
                <input
                  type="checkbox"
                  onChange={selectAllVisible}
                />
              </th>
              <th className="p-2 text-left">Date</th>
              <th className="p-2 text-left">Ref</th>
              <th className="p-2 text-left">Member</th>
              <th className="p-2 text-left">Description</th>
              <th className="p-2 text-right">Amount</th>
            </tr>
          </thead>

          <tbody>
            {paginated.map((j) => (
              <>
                <tr
                  key={j.id}
                  className="border-t hover:bg-gray-50 cursor-pointer"
                >
                  <td className="p-2">
                    <input
                      type="checkbox"
                      checked={selectedRows.includes(j.id)}
                      onChange={() => toggleSelect(j.id)}
                    />
                  </td>

                  <td className="p-2" onClick={() =>
                    setExpanded(expanded === j.id ? null : j.id)
                  }>
                    {j.date}
                  </td>

                  <td className="p-2" onClick={() =>
                    setExpanded(expanded === j.id ? null : j.id)
                  }>
                    {j.reference}
                  </td>

                  <td className="p-2">{j.member_no}</td>

                  <td className="p-2">{j.description}</td>

                  <td className="p-2 text-right font-bold">
                    KES {format(j.amount)}
                  </td>
                </tr>

                {expanded === j.id && (
                  <tr>
                    <td colSpan="6" className="bg-gray-50 p-4">
                      <div className="grid grid-cols-3 gap-3 text-sm">

                        <div>
                          <p className="font-bold text-green-700">Debit Account</p>
                          <p>{j.debit_account_id}</p>
                        </div>

                        <div>
                          <p className="font-bold text-red-700">Credit Account</p>
                          <p>{j.credit_account_id}</p>
                        </div>

                        <div>
                          <p className="font-bold">Status</p>
                          <p>{j.status || "posted"}</p>
                        </div>

                        <div>
                          <p className="font-bold">Reference</p>
                          <p>{j.reference}</p>
                        </div>

                        <div>
                          <p className="font-bold">Created</p>
                          <p>{j.created_at}</p>
                        </div>

                        <div>
                          <p className="font-bold">Amount</p>
                          <p>KES {format(j.amount)}</p>
                        </div>

                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* PAGINATION */}
      <div className="flex justify-between items-center mt-4">
        <button
          disabled={page === 1}
          onClick={() => setPage((p) => p - 1)}
          className="px-3 py-1 border rounded disabled:opacity-40"
        >
          Prev
        </button>

        <span className="text-sm">
          Page {page} / {totalPages || 1}
        </span>

        <button
          disabled={page === totalPages}
          onClick={() => setPage((p) => p + 1)}
          className="px-3 py-1 border rounded disabled:opacity-40"
        >
          Next
        </button>
      </div>

    </div>
  );
}