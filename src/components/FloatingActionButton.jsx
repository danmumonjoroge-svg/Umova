import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export default function FloatingActionButton() {
  const [open, setOpen] = useState(false);

  const actions = [
    { label: "Deposit", onClick: () => alert("Deposit clicked") },
    { label: "Request Loan", onClick: () => alert("Loan clicked") },
    { label: "Download Statement", onClick: () => alert("Statement downloaded") },
  ];

  return (
    <div className="fixed bottom-6 right-6 flex flex-col items-end gap-3 z-50">
      <AnimatePresence>
        {open &&
          actions.map((a, i) => (
            <motion.button
              key={i}
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 50 }}
              transition={{ duration: 0.2, delay: i * 0.05 }}
              onClick={a.onClick}
              className="bg-blue-600 text-white px-4 py-2 rounded shadow-lg hover:bg-blue-700 transition"
            >
              {a.label}
            </motion.button>
          ))}
      </AnimatePresence>

      <button
        onClick={() => setOpen(!open)}
        className="bg-green-700 w-14 h-14 rounded-full text-white text-2xl flex items-center justify-center shadow-lg hover:bg-green-800 transition"
      >
        {open ? "×" : "+"}
      </button>
    </div>
  );
}