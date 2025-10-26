// src/components/dashboard/GuessRingContainer.tsx

import React, { useEffect, useMemo, useState } from "react";

import { useNavigate } from "react-router-dom";

import type { GuessData } from "../../types/types";

import CircularGuessRingUI from "./SimpleGuessRing";

import CheckValidity from "../validity/CheckValidity";

interface HashDetails {
  actualHash: string;
  secretKey: string;
  dummyHash: string;
  targetBlockNumber: number;
  tokenSizes: number;
  paidGuess: boolean;
  complex: boolean;
}

interface StoredGuessData {
  Sno?: number; // 1..5
  guessId?: number; // sometimes used
  id?: number; // fallback
  blockIncrementCount?: number;
  blockHashGuess?: string;
  tokenSize?: number;
  paymentPaidBet?: string | number; // "0" or amount
  overWrite?: boolean;
  complex?: boolean;
  dummyHash?: string;
  actualHash?: string;
  secretKey?: string;
  tokens?: string;
  timestamp?: number;
  txHash?: string;
  gasUsed?: string;
  formattedPayment?: string;
  // NEW: From contract event (for displaying actual target block)
  contractBlockNumber?: string;
}

interface GuessRingContainerProps {
  guesses: GuessData[];
  selectedGuess: GuessData | null;
  onSelectGuess: (guess: GuessData) => void;
  onNewGuess?: (guessId: number) => void;
  onVerify?: (guessId: number) => void;
  onCheckValidity?: (guessId: number) => void;
}

const IDs = [1, 2, 3, 4, 5];

const GuessRingContainer: React.FC<GuessRingContainerProps> = ({
  guesses,
  selectedGuess,
  onSelectGuess,
  onNewGuess,
  onVerify,
  onCheckValidity,
}) => {
  // Existing states for ring behavior
  const navigate = useNavigate();
  const [activeGuessId, setActiveGuessId] = useState<number | null>(null);
  const [clockwiseAngle, setClockwiseAngle] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const [hashDetails, setHashDetails] = useState<HashDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isRotationPaused, setIsRotationPaused] = useState(false);
  const [isSelectedGuessPlaced, setIsSelectedGuessPlaced] = useState(false);

  const [isValidityModalOpen, setIsValidityModalOpen] = useState(false);
  const [validityCheckGuessId, setValidityCheckGuessId] = useState<
    number | null
  >(null);

  // NEW: persistent per-Sno details: 1..5
  const [allGuessDetails, setAllGuessDetails] = useState<
    Record<number, HashDetails>
  >({});

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    if (isRotationPaused) return;
    const interval = setInterval(() => {
      setClockwiseAngle((prev) => (prev + 0.6) % 360);
    }, 50);
    return () => clearInterval(interval);
  }, [isRotationPaused]);

  // Helpers to normalize storage -> HashDetails
  const toHashDetails = (d?: StoredGuessData): HashDetails | null => {
    if (!d) return null;
    return {
      actualHash: d.actualHash ?? "-",
      secretKey: d.secretKey ?? "-",
      dummyHash: d.dummyHash ?? "-",
      // FIXED: Prioritize contractBlockNumber if available, else fallback to input blockIncrementCount
      targetBlockNumber: Number(
        d.contractBlockNumber ?? d.blockIncrementCount ?? 0,
      ),
      tokenSizes: Number(d.tokenSize ?? 0),
      paidGuess: String(d.paymentPaidBet ?? "0") !== "0",
      complex: Boolean(d.complex ?? false),
    };
  };
  // NEW: Handler to open the validity check modal
  const handleOpenValidityCheck = (guessId: number) => {
    setValidityCheckGuessId(guessId);
    setIsValidityModalOpen(true);
    setActiveGuessId(null); // Close the action buttons
    setIsRotationPaused(false);
  };

// Read a single guess by id - WALLET-SPECIFIC VERSION
const readSingleGuess = (guessId: number): HashDetails | null => {
  try {
    const currentAccount = localStorage.getItem("currentAccount");
    if (!currentAccount) return null;

    const walletAddress = currentAccount.toLowerCase();
    
    // 1️⃣ Check wallet-specific aggregate store
    const walletGuessKey = `guesses_${walletAddress}`;
    const aggRaw = localStorage.getItem(walletGuessKey);
    if (aggRaw) {
      const parsed = JSON.parse(aggRaw);
      const list: StoredGuessData[] = Array.isArray(parsed) ? parsed : [];
      const found = list.find((x) => Number(x.Sno ?? x.guessId ?? x.id) === guessId);
      const hd = toHashDetails(found);
      if (hd) return hd;
    }

    // 2️⃣ Check individual guess key (backward compatibility)
    const individualKey = `guesses/${walletAddress}/${guessId}`;
    const raw = localStorage.getItem(individualKey);
    if (raw) {
      const d: StoredGuessData = JSON.parse(raw);
      const hd = toHashDetails(d);
      if (hd) return hd;
    }

    // 3️⃣ Check last guess for this wallet
    const lastGuessKey = `lastGuess_${walletAddress}`;
    const last = localStorage.getItem(lastGuessKey);
    if (last) {
      const d: StoredGuessData = JSON.parse(last);
      const idInLast = Number(d.guessId ?? d.Sno ?? d.id);
      if (idInLast === guessId) {
        const hd = toHashDetails(d);
        if (hd) return hd;
      }
    }

    return null;
  } catch (error) {
    console.error("Error reading guess:", error);
    return null;
  }
};


  // Build full per-Sno map 1..5
  const buildAll = (): Record<number, HashDetails> => {
    const map: Record<number, HashDetails> = {};
    for (const id of IDs) {
      const hd = readSingleGuess(id);
      if (hd) map[id] = hd;
    }
    return map;
  };

  // Prime and auto-refresh the per-Sno details
  useEffect(() => {
    const refresh = () => setAllGuessDetails(buildAll());
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  // Keep existing "UNVERIFIED" chip logic in sync with selectedGuess presence
  useEffect(() => {
    if (selectedGuess) {
      setIsSelectedGuessPlaced(Boolean(allGuessDetails[selectedGuess.id]));
    } else {
      setIsSelectedGuessPlaced(false);
    }
  }, [selectedGuess, allGuessDetails]);

  // Legacy center fetch for modal-style details (unchanged)
  const fetchGuessDataFromStorage = (guessId: number): HashDetails => {
    return (
      readSingleGuess(guessId) ?? {
        actualHash: "-",
        secretKey: "-",
        dummyHash: "-",
        targetBlockNumber: 0,
        tokenSizes: 0,
        paidGuess: false,
        complex: false,
      }
    );
  };

  // Layout helpers (unchanged)
  const getOrbitRadius = () =>
    isMobile ? Math.min(window.innerWidth, window.innerHeight) * 0.22 : 200;
  const getNumberSize = () => (isMobile ? 50 : 60);
  const orbitRadius = getOrbitRadius();
  const numberSize = getNumberSize();

  // Actions (unchanged)
  const handleNewGuessClick = (guessId: number) => {
    navigate(`/guess/${guessId}`);
    if (onNewGuess) onNewGuess(guessId);
  };

  const handleNumberClick = (guess: GuessData) => {
    if (!isExpanded) {
      onSelectGuess(guess);
      setActiveGuessId((curr) => (curr === guess.id ? null : guess.id));
      setIsRotationPaused(true);
    }
  };

  const handleActionClick = (
    action?: (id: number) => void,
    guessId?: number,
  ) => {
    if (action && guessId) action(guessId);
    setActiveGuessId(null);
    setIsRotationPaused(false);
  };

  const handleCenterClick = async () => {
    if (!isExpanded) {
      setLoading(true);
      setTimeout(() => {
        const guessId = selectedGuess?.id || 1;
        const fetchedData = fetchGuessDataFromStorage(guessId);
        setHashDetails(fetchedData);
        setLoading(false);
        setIsExpanded(true);
        setActiveGuessId(null);
        setIsRotationPaused(false);
      }, 500);
    } else {
      setIsExpanded(false);
      setHashDetails(null);
    }
  };

  const handleCloseActions = () => {
    setActiveGuessId(null);
    setIsRotationPaused(false);
  };

  const handleBackFromDetails = () => {
    setIsExpanded(false);
    setHashDetails(null);
    setIsRotationPaused(false);
  };

  const getBigCirclePosition = () => {
    const centerY = window.innerHeight / 2;
    if (isExpanded) {
      return isMobile
        ? { x: window.innerWidth / 2, y: centerY }
        : { x: window.innerWidth * 0.15, y: centerY };
    }
    return { x: window.innerWidth / 2, y: centerY };
  };

  const bigCirclePosition = getBigCirclePosition();

  const actionButtons = useMemo(
    () => [
      {
        label: "New Guess",
        color: "#3b82f6",
        bgColor: "from-blue-500 to-blue-600",
        icon: "➕",
        action: handleNewGuessClick,
        description: "Create new guess",
      },
      {
        label: "Verify",
        color: "#10b981",
        bgColor: "from-green-500 to-green-600",
        icon: "✔️",
        action: onVerify,
        description: "Verify guess",
      },
      {
        label: "Check Validity",
        color: "#f59e0b",
        bgColor: "from-yellow-500 to-yellow-600",
        icon: "🔍",
        action: handleOpenValidityCheck, // Use the new handler
        description: "Check validity",
      },
    ],
    [onVerify, onCheckValidity, onNewGuess],
  );

  // Render the UI (existing JSX unchanged, but hashDetails now uses contractBlockNumber)
  return (
    <>
      {/* Your existing JSX for the ring and details rendering here -
           hashDetails.targetBlockNumber will now show contract value */}
      <CircularGuessRingUI
        guesses={guesses}
        selectedGuess={selectedGuess}
        activeGuessId={activeGuessId}
        clockwiseAngle={clockwiseAngle}
        isExpanded={isExpanded}
        hashDetails={hashDetails}
        loading={loading}
        isMobile={isMobile}
        isSelectedGuessPlaced={isSelectedGuessPlaced}
        bigCirclePosition={bigCirclePosition}
        orbitRadius={orbitRadius}
        numberSize={numberSize}
        actionButtons={actionButtons}
        onNumberClick={handleNumberClick}
        onActionClick={handleActionClick}
        onCenterClick={handleCenterClick}
        onCloseActions={handleCloseActions}
        onBackFromDetails={handleBackFromDetails}
      />
      {/* NEW: Conditional rendering for the modal */}
      {isValidityModalOpen && validityCheckGuessId && (
        <div
          className="fixed inset-0 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setIsValidityModalOpen(false)}
        >
          {/* Stop propagation to prevent closing when clicking inside the modal */}
          <div onClick={(e) => e.stopPropagation()}>
            <CheckValidity
              guessId={validityCheckGuessId}
              onClose={() => setIsValidityModalOpen(false)}
            />
          </div>
        </div>
      )}
    </>
  );
};

export default GuessRingContainer;
