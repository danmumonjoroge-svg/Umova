import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../../supabaseClient";
import { 
  Search, User, Send, FileText, Receipt, 
  CheckCircle, Clock, AlertTriangle, MessageSquare, Loader2, RefreshCw 
} from "lucide-react";

// Integration Hooks for your core business engines
import { generateMemberStatement } from "../../services/generateMemberStatement";
import { generateReceiptPDF } from "../../services/receiptService";
import { uploadPDFToStorage } from "../../services/documentService";
import { pushToOutbox } from "../../services/outboxService";

import "./WhatsAppCenter.css";

// Normalized Ledger Configuration Maps
const ACCOUNT_MAP = {
  1018: "Savings Ledger",
  1012: "Share Capital",
  1011: "Loan Amortization Principal",
  1020: "Loan Interest Account",
};

/**
 * Universal KE Phone Formatter Core Utility
 * Cleans user inputs to comply strictly with WhatsApp E.164 string rules
 */
const formatPhone = (phone) => {
  if (!phone) return "";
  let digits = String(phone).replace(/\D/g, "");
  if (digits.startsWith("0")) digits = "254" + digits.slice(1);
  if (digits.length === 9) digits = "254" + digits;
  return digits;
};

export default function WhatsAppCenter() {
  // --- Core Core Synchronization Hooks ---
  const [members, setMembers] = useState([]);
  const [outbox, setOutbox] = useState([]);
  const [selectedMember, setSelectedMember] = useState(null);
  
  // --- Search & Real-Time Filter Tracking ---
  const [searchQuery, setSearchQuery] = useState("");
  
  // --- Action Protocol Matrix Hooks ---
  const [selectedAction, setSelectedAction] = useState("statement"); 
  const [historicalReceipts, setHistoricalReceipts] = useState([]);
  const [selectedReceiptNo, setSelectedReceiptNo] = useState("");
  const [memberLedgerCache, setMemberLedgerCache] = useState([]);
  
  // --- Compiled Message Customization Area ---
  const [compiledPreview, setCompiledPreview] = useState("");
  
  // --- Performance & UX Loader Anchors ---
  const [isCompiling, setIsCompiling] = useState(false);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [processingOutboxId, setProcessingOutboxId] = useState(null);

  // Initial Sync Matrix Lifecycle
  useEffect(() => {
    fetchCoreInfrastructure();
  }, []);

  const fetchCoreInfrastructure = async () => {
    setGlobalLoading(true);
    await Promise.all([loadMembersIndex(), loadOutboxQueue()]);
    setGlobalLoading(false);
  };

  const loadMembersIndex = async () => {
    const { data, error } = await supabase
      .from("members")
      .select("*")
      .order("name", { ascending: true });
    if (error) console.error("Critical error reading member master data:", error);
    else setMembers(data || []);
  };

  const loadOutboxQueue = async () => {
    const { data, error } = await supabase
      .from("whatsapp_outbox")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) console.error("Critical error syncing communication queue entries:", error);
    else setOutbox(data || []);
  };

  // --- Optimized Computational Fuzzy Search Module ---
  const filteredMembers = useMemo(() => {
    if (!searchQuery.trim()) return members;
    const normalizedQuery = searchQuery.toLowerCase();
    return members.filter((m) => {
      const fieldBlock = `${m.name} ${m.member_no} ${m.phone}`.toLowerCase();
      return fieldBlock.includes(normalizedQuery);
    });
  }, [members, searchQuery]);

  /**
   * High-Performance Context Loader
   * Executed when a user targets a member asset from the sidebar directory registry
   */
  const handleContextSwitch = async (memberTarget) => {
    setSelectedMember(memberTarget);
    setCompiledPreview("");
    setSelectedReceiptNo("");
    setHistoricalReceipts([]);
    
    // Scrape active accounting logs for statements and tracking linkages
    const { data, error } = await supabase
      .from("general_ledger")
      .select("*")
      .eq("member_no", memberTarget.member_no)
      .order("date", { ascending: false });

    if (error) {
      console.error("Anomalous error reading transactional accounting entries:", error);
      return;
    }

    const ledgerRows = data || [];
    setMemberLedgerCache(ledgerRows);

    // Filter, map and isolate atomic unique historical payment tracking IDs
    const trackingMap = {};
    ledgerRows.forEach((row, index) => {
      if (row.receipt_no && !trackingMap[row.receipt_no]) {
        trackingMap[row.receipt_no] = {
          receipt_no: row.receipt_no,
          date: row.date,
          amount: row.amount,
          uniqueRef: `${row.receipt_no}_${index}`
        };
      }
    });
    setHistoricalReceipts(Object.values(trackingMap));
  };

  // Run dynamic compilation macros instantly when control adjustments shift state
  useEffect(() => {
    if (selectedMember) {
      compileWorkflowTemplate();
    }
  }, [selectedAction, selectedMember, selectedReceiptNo]);

  /**
   * Action Template Dispatch Engine
   * Generates production template matrices based on context changes
   */
  const compileWorkflowTemplate = () => {
    if (!selectedMember) return;

    switch (selectedAction) {
      case "statement":
        setCompiledPreview(`📄 *ACCOUNT FINANCIAL STATEMENT REPORT*\n\nDear ${selectedMember.name},\n\nYour active member capital accounts summary report profile has been generated successfully.\n\n📥 *Download Live Document Here:*\n[System will auto-attach generated PDF download link here]\n\nRef ID: ${selectedMember.member_no}\nThank you for choosing financial clarity.`);
        break;

      case "receipt":
        if (!selectedReceiptNo) {
          setCompiledPreview("⚠️ ACTION REQUIRED: Link a verified historical transaction code from the amber drop-down widget above to finalize data compilation...");
          return;
        }
        const activeVoucher = historicalReceipts.find(r => r.receipt_no === selectedReceiptNo);
        setCompiledPreview(`🧾 *TRANSACTION RECEIPT CONFIRMATION*\n\nDear ${selectedMember.name},\n\nWe confirm receipt of *KES ${Number(activeVoucher?.amount || 0).toLocaleString()}* allocated towards your investment accounts on ${activeVoucher?.date || 'N/A'}.\n\n*Receipt Code:* ${selectedReceiptNo}\n📥 *Download Official Copy:*\n[System will auto-attach generated receipt PDF link here]\n\nThank you for your timely deposit contribution.`);
        break;

      case "loan_approved":
        setCompiledPreview(`🎉 *CREDIT FACILITY APPLICATION APPROVED*\n\nDear ${selectedMember.name},\n\nWe are pleased to inform you that your development credit facility application request has been evaluated, approved, and cleared for payment by the credit committee board.\n\nFunds allocation routing will map into your registered liquidation node shortly.\n\nRegards,\n*Credit Management Bureau Office*`);
        break;

      case "loan_due":
        setCompiledPreview(`⏰ *UPCOMING CREDIT REPAYMENT REMINDER*\n\nDear ${selectedMember.name},\n\nThis is an advance operational notification that your periodic credit amortization installment is scheduled for processing inside the next 5 days.\n\nKindly secure sufficient liquidity within your clearing account to prevent automated compliance collection penalties.`);
        break;

      case "loan_arrears":
        setCompiledPreview(`⚠️ *CRITICAL ACCOUNT DELINQUENCY NOTICE*\n\nDear ${selectedMember.name},\n\n*IMMEDIATE ACTION REQUIRED.* Your credit amortization settlement timeline has lapsed. Your loan facility is officially flagged as heavily in arrears.\n\nTo safeguard your guarantor matrix network and prevent emergency legal debt asset liquidation protocols, clear your outstanding balance immediately.`);
        break;

      case "manual":
        // Persist arbitrary freeform string blocks entered by staff overrides
        break;

      default:
        setCompiledPreview("");
    }
  };

  /**
   * Process Compilation Dispatch Core Engine
   * Validates state data, builds binary file records, pushes outputs to cloud tables
   */
  const handleQueueDispatchPipeline = async () => {
    if (!selectedMember) return alert("System Core Error: Active user context target is missing.");
    
    try {
      setIsCompiling(true);
      let resolvedMessagePayload = compiledPreview;

      // Handle Complex Dynamic Statement Compilations
      if (selectedAction === "statement") {
        const docBlob = await generateMemberStatement(selectedMember, memberLedgerCache);
        const cloudUrl = await uploadPDFToStorage(docBlob, `statements/${selectedMember.member_no}_${Date.now()}.pdf`);
        resolvedMessagePayload = resolvedMessagePayload.replace("[System will auto-attach generated PDF download link here]", cloudUrl);
      }
      
      // Handle Complex Dynamic Receipt Document Generation Pipelines
      if (selectedAction === "receipt") {
        if (!selectedReceiptNo) throw new Error("A valid ledger tracking code must be linked before dispatch execution.");
        const singleTargetTrx = historicalReceipts.find(r => r.receipt_no === selectedReceiptNo);
        const relativeTransactionLines = memberLedgerCache.filter(l => l.receipt_no === selectedReceiptNo);
        
        const docBlob = await generateReceiptPDF(selectedMember, singleTargetTrx, relativeTransactionLines);
        const cloudUrl = await uploadPDFToStorage(docBlob, `receipts/${selectedReceiptNo}.pdf`);
        resolvedMessagePayload = resolvedMessagePayload.replace("[System will auto-attach generated receipt PDF link here]", cloudUrl);
      }

      // Execute payload transmission directly down outbox data nodes
      await pushToOutbox({
        member_no: selectedMember.member_no,
        phone: formatPhone(selectedMember.phone),
        type: selectedAction,
        message: resolvedMessagePayload,
      });

      // Reset application states cleanly upon successful operations
      await loadOutboxQueue();
      if (selectedAction !== "manual") compileWorkflowTemplate();
      else setCompiledPreview("");
      
      alert("Success: Communication bundle compiled and locked inside pipeline queue.");
    } catch (faultEx) {
      console.error("Pipeline failure detected:", faultEx);
      alert(`Pipeline Compilation Failure: ${faultEx.message || "Unknown execution mapping error."}`);
    } finally {
      setIsCompiling(false);
    }
  };

  /**
   * Optimistic Immediate Native Dispatch Engine
   * Routes string blocks out to native windows, deleting rows eagerly to avoid double dispatches
   */
  const handleNativeWhatsAppRedirect = async (queueItem) => {
    try {
      setProcessingOutboxId(queueItem.id);
      const optimizedPhone = formatPhone(queueItem.phone);
      const gatewayURL = `https://wa.me/${optimizedPhone}?text=${encodeURIComponent(queueItem.message)}`;
      
      // Fire browser system window target to open communication nodes safely
      window.open(gatewayURL, "_blank");

      // Optimistic Wipe: Remove tracking rows from outbox before network sync updates complete
      const { error } = await supabase.from("whatsapp_outbox").delete().eq("id", queueItem.id);
      if (error) throw error;
      
      // Sync local collection logs immediately
      await loadOutboxQueue();
    } catch (syncFault) {
      console.error("Outbox clearance operational failure anomaly:", syncFault);
      alert("System Sync Alert: Failed to clear message instance context from data registry.");
    } finally {
      setProcessingOutboxId(null);
    }
  };

  return (
    <div className="whatsapp-container">
      {/* APP BAR HEADER CONTROL */}
      <header className="whatsapp-header-wrapper">
        <div className="title-block-area">
          <h1 className="whatsapp-title">Enterprise Communications Management Node</h1>
          <p className="whatsapp-subtitle">Core ledger messaging pipelines, automated file generation routing, and credit collection engines.</p>
        </div>
        <button onClick={fetchCoreInfrastructure} className="refresh-btn" disabled={globalLoading}>
          <RefreshCw className={`h-4 w-4 ${globalLoading ? "animate-spin" : ""}`} />
          Sync Infrastructure Hub
        </button>
      </header>

      {/* THREE-COLUMN DOCK COMPANION CANVAS */}
      <div className="whatsapp-grid">
        
        {/* PANEL 1: MASTER LIST DIRECTORY REGISTRY */}
        <div className="whatsapp-panel">
          <div className="panel-title"><Search size={14} className="text-emerald-500" /> Member Directory Registry</div>
          <input
            type="text"
            placeholder="Search indexing parameter (Name, ID, Phone)..."
            className="search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          
          {globalLoading ? (
            <div className="loading-state"><Loader2 className="animate-spin text-emerald-500" /> Loading account logs...</div>
          ) : (
            <div className="member-list">
              {filteredMembers.map((member) => (
                <div
                  key={member.member_no}
                  className={`member-card ${selectedMember?.member_no === member.member_no ? "active" : ""}`}
                  onClick={() => handleContextSwitch(member)}
                >
                  <div className="member-name">{member.name}</div>
                  <div className="member-meta">Member ID: {member.member_no} • Route: {member.phone}</div>
                </div>
              ))}
              {filteredMembers.length === 0 && <div className="empty-state">No matching member profiles registered.</div>}
            </div>
          )}
        </div>

        {/* PANEL 2: THE PROCESSING DESK (EXTENDED HORIZONTAL CANVAS) */}
        <div className="whatsapp-panel">
          <div className="panel-title"><User size={14} className="text-blue-500" /> Secure Document Compilation Desk</div>
          
          {!selectedMember ? (
            <div className="empty-state">
              Select an active member asset from the registry sidebar index layout to engage communications workflows.
            </div>
          ) : (
            <div className="workflow-deck">
              <div className="member-info-box">
                <h2>{selectedMember.name}</h2>
                <div className="member-meta">Ref Account: #{selectedMember.member_no} | Target Mobile Terminal: {selectedMember.phone}</div>
              </div>

              {/* AUTOMATION DISPATCH PROTOCOL SELECTOR DROPDOWN */}
              <div className="form-group">
                <label className="input-label">Select Template Action Protocol:</label>
                <select 
                  className="action-dropdown"
                  value={selectedAction}
                  onChange={(e) => setSelectedAction(e.target.value)}
                >
                  <option value="statement">📄 Comprehensive Financial Account Statement Summary Link</option>
                  <option value="receipt">🧾 Dynamic Payment Allocation Receipt Confirmation Voucher</option>
                  <option value="loan_approved">🎉 Credit Underwriting Board Loan Approval Notification</option>
                  <option value="loan_due">⏰ Periodic Loan Amortization Installment Alert Reminder</option>
                  <option value="loan_arrears">⚠️ Critical Credit Facility Delinquency & Arrears Warning Balance</option>
                  <option value="manual">✍️ Custom Ad-Hoc Communication Override (Free Text Template)</option>
                </select>
              </div>

              {/* NESTED DYNAMIC REVENUE VOUCHER TRANSACTIONS HARVESTER */}
              {selectedAction === "receipt" && (
                <div className="form-group sub-select-box">
                  <label className="input-label" style={{color: '#fbbf24'}}>Link Verified Historical Account Receipt Voucher:</label>
                  <select
                    className="action-dropdown"
                    style={{borderColor: 'rgba(251,191,36,0.3)'}}
                    value={selectedReceiptNo}
                    onChange={(e) => setSelectedReceiptNo(e.target.value)}
                  >
                    <option value="">-- Choose active system payment transaction transaction code --</option>
                    {historicalReceipts.map(receiptItem => (
                      <option key={receiptItem.uniqueRef} value={receiptItem.receipt_no}>
                        Code: {receiptItem.receipt_no} ({receiptItem.date}) - KES {Number(receiptItem.amount).toLocaleString()}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* COMPILE TERMINAL BUFFER INTERACTION FIELD CONTAINER */}
              <div className="form-group" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                <label className="input-label">Live Messaging Payload Compilation Buffer Workspace:</label>
                <textarea
                  className="textarea preview-area"
                  value={compiledPreview}
                  readOnly={selectedAction !== "manual"}
                  onChange={(e) => selectedAction === "manual" && setCompiledPreview(e.target.value)}
                  placeholder="Draft your raw arbitrary message variables natively here..."
                />
              </div>

              <button 
                className="btn btn-primary" 
                onClick={handleQueueDispatchPipeline}
                disabled={isCompiling || (selectedAction === "receipt" && !selectedReceiptNo)}
              >
                {isCompiling ? (
                  <><Loader2 className="animate-spin h-4 w-4" /> Assembling Document Binaries and Links...</>
                ) : (
                  <><Send className="h-4 w-4" /> Lock & Queue Compiled Payload Package to Pipeline Box</>
                )}
              </button>
            </div>
          )}
        </div>

        {/* PANEL 3: REAL-TIME OUTBOX ROUTING TRACKER */}
        <div className="whatsapp-panel">
          <div className="panel-title"><Send size={14} className="text-purple-500" /> Outbox Delivery Pipeline Queue</div>
          
          <div className="outbox-list">
            {outbox.length === 0 ? (
              <div className="empty-state">Pipeline status code clear. No entries waiting for transmission hooks.</div>
            ) : (
              outbox.map((queueItem) => (
                <div key={queueItem.id} className="outbox-card-advanced">
                  <div className="outbox-card-header">
                    <span className="badge-type">{queueItem.type}</span>
                    <span className="badge-phone">+{queueItem.phone}</span>
                  </div>
                  <div className="outbox-message-body">{queueItem.message}</div>
                  <button 
                    className="btn btn-dispatch" 
                    onClick={() => handleNativeWhatsAppRedirect(queueItem)}
                    disabled={processingOutboxId === queueItem.id}
                  >
                    {processingOutboxId === queueItem.id ? (
                      <><Loader2 className="animate-spin h-3 w-3" /> Clearing Sync Logs...</>
                    ) : (
                      <><Send className="h-3 w-3" /> Dispatch Via WhatsApp Web Native</>
                    )}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  );
}