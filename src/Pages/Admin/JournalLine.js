import { useEffect, useState, useMemo } from "react";
import { supabase } from "../../supabaseClient";

export default function JournalList() {

  const [journal, setJournal] = useState([]);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [page, setPage] = useState(1);

  const PAGE_SIZE = 10;

  useEffect(() => {
    loadJournal();
  }, []);

  const loadJournal = async () => {
    const { data, error } = await supabase
      .from("general_ledger")
      .select("*")
      .order("date", { ascending: false });

    if (error) {
      alert(error.message);
      return;
    }

    setJournal(data || []);
  };

  /* FILTER */
  const filtered = useMemo(() => {
    return journal.filter(j =>
      j.description?.toLowerCase().includes(search.toLowerCase())
    );
  }, [journal, search]);

  /* PAGINATION */
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE
  );

  /* EXPORT CSV */
  const exportCSV = () => {
    const rows = [
      ["Date", "Member", "Description", "Debit", "Credit", "Amount"]
    ];

    filtered.forEach(j => {
      rows.push([
        j.date,
        j.member_no,
        j.description,
        j.debit_account,
        j.credit_account,
        j.amount
      ]);
    });

    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });

    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "journal.csv";
    link.click();
  };

  /* PRINT PDF */
  const printPDF = () => {
    window.print();
  };

  return (
    <div style={styles.container}>

      {/* HEADER */}
      <div style={styles.header}>
        <h2>📘 Journal Entries</h2>

        <div style={styles.actions}>
          <button onClick={exportCSV} style={styles.btn}>Export Excel</button>
          <button onClick={printPDF} style={styles.btn}>Print PDF</button>
        </div>
      </div>

      {/* SEARCH */}
      <input
        placeholder="Search description..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={styles.input}
      />

      {/* TABLE */}
      <table style={styles.table}>

        <thead>
          <tr style={styles.thead}>
            <th>Date</th>
            <th>Member</th>
            <th>Description</th>
            <th style={{ textAlign: "right" }}>Amount</th>
          </tr>
        </thead>

        <tbody>
          {paginated.map((j, i) => (
            <>
              {/* MAIN ROW */}
              <tr
                key={j.id}
                style={{
                  ...styles.row,
                  background: i % 2 ? "#f9fafb" : "white",
                  cursor: "pointer"
                }}
                onClick={() =>
                  setExpanded(expanded === j.id ? null : j.id)
                }
              >
                <td>{j.date}</td>
                <td>{j.member_no}</td>
                <td>{j.description}</td>
                <td style={styles.amount}>
                  KES {Number(j.amount || 0).toLocaleString()}
                </td>
              </tr>

              {/* DRILL DOWN */}
              {expanded === j.id && (
                <tr>
                  <td colSpan="4">
                    <div style={styles.drill}>

                      <div style={styles.line}>
                        <span>Debit:</span>
                        <span style={styles.debit}>
                          {j.debit_account}
                        </span>
                      </div>

                      <div style={styles.line}>
                        <span>Credit:</span>
                        <span style={styles.credit}>
                          {j.credit_account}
                        </span>
                      </div>

                    </div>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>

      {/* PAGINATION */}
      <div style={styles.pagination}>
        <button
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
        >
          Prev
        </button>

        <span>Page {page} / {totalPages || 1}</span>

        <button
          disabled={page === totalPages}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>

    </div>
  );
}

/* STYLES */
const styles = {
  container: {
    background: "white",
    padding: 20,
    borderRadius: 12
  },

  header: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: 10
  },

  actions: {
    display: "flex",
    gap: 10
  },

  btn: {
    padding: "6px 10px",
    borderRadius: 6,
    border: "none",
    background: "#16a34a",
    color: "white",
    cursor: "pointer"
  },

  input: {
    marginBottom: 10,
    padding: 8,
    width: "100%",
    borderRadius: 6,
    border: "1px solid #ddd"
  },

  table: {
    width: "100%",
    borderCollapse: "collapse"
  },

  thead: {
    background: "#f3f4f6"
  },

  row: {
    borderBottom: "1px solid #eee"
  },

  amount: {
    textAlign: "right",
    fontWeight: "bold"
  },

  drill: {
    padding: 10,
    background: "#f9fafb",
    borderRadius: 8
  },

  line: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: 5
  },

  debit: {
    color: "green",
    fontWeight: "bold"
  },

  credit: {
    color: "red",
    fontWeight: "bold"
  },

  pagination: {
    marginTop: 15,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center"
  }
};