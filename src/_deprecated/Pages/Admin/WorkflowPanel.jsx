import { useState } from "react";
import { createWorkflow, approveWorkflow } from "../../services/workflowAPI";

export default function WorkflowPanel() {

  const user = { id: "u1", role: "manager" };

  const [result, setResult] = useState(null);

  const startWorkflow = async () => {
    const res = await createWorkflow(
      "loan_disbursement",
      { amount: 50000, member_id: "M001" },
      user
    );

    setResult(res);
  };

  const approve = async () => {
    const res = await approveWorkflow("REQ-1", user);
    setResult(res);
  };

  return (
    <div className="bg-white p-4 rounded shadow">

      <h2 className="font-bold mb-3">
        Workflow Approval Engine
      </h2>

      <button
        onClick={startWorkflow}
        className="bg-blue-600 text-white px-3 py-2 rounded w-full"
      >
        Create Workflow
      </button>

      <button
        onClick={approve}
        className="bg-green-600 text-white px-3 py-2 rounded w-full mt-2"
      >
        Approve Step
      </button>

      {result && (
        <pre className="mt-4 text-xs bg-gray-100 p-2">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}

    </div>
  );
}