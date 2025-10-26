import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Search,
  CheckCircle,
  XCircle,
  Hash,
  Cpu,
  Zap,
  AlertTriangle,
  Info,
  Hammer,
} from "lucide-react";
import Web3 from "web3";
import { useAuth } from "../../context/AuthContext";
import { database } from "../../config/firebase";
import { ref, set } from "firebase/database";

// ✅ NEW: Helper function to generate wallet-specific localStorage keys
const getWalletStorageKey = (baseKey: string, walletAddress: string | null): string => {
  if (!walletAddress || walletAddress === "0x0") {
    return baseKey; // Fallback to non-scoped key
  }
  return `${baseKey}_${walletAddress.toLowerCase()}`;
};

// Interfaces
interface StoredGuessData {
  Sno: number;
  blockIncrementCount: number;
  blockHashGuess: string;
  tokenSize: number;
  paymentPaidBet: string;
  overWrite: boolean;
  complex: boolean;
  dummyHash: string;
  actualHash: string;
  secretKey: string;
  guessId: number;
  tokens: string[];
  timestamp: number;
  txHash?: string;
  gasUsed?: string;
  formattedPayment: string;
  contractBlockNumber?: string;
}

interface BlockRangeIndication {
  blockDistance: number;
  indication: "dark green" | "light green" | "light red" | "dark red";
  color: string;
}

interface ComplexCalculation {
  targetBlockNumber: number;
  targetBlockHash: string;
  byteHex: string;
  adjustedRanBlockPos: number;
  randomBlockNumber: number;
  randomBlockHash: string;
}

const VerifyOffChain: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const guessId = parseInt(id || "1", 10);
  const { connectedAccount } = useAuth();

  // State management
  const [storedGuessData, setStoredGuessData] =
    useState<StoredGuessData | null>(null);
  const [targetBlockCount, setTargetBlockCount] = useState<number | null>(null);
  const [currentBlockNumber, setCurrentBlockNumber] = useState<number>(0);
  const [fetchedBlockHash, setFetchedBlockHash] = useState<string>("");
  const [tokenSize, setTokenSize] = useState<number>(0);
  const [matchResult, setMatchResult] = useState<boolean | null>(null);
  const [showMatchDetails, setShowMatchDetails] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [alertMessage, setAlertMessage] = useState<{
    type: "success" | "error" | "warning" | "info";
    message: string;
  } | null>(null);
  const [blockRangeIndication, setBlockRangeIndication] =
    useState<BlockRangeIndication>({
      blockDistance: 0,
      indication: "dark green",
      color: "#10b981",
    });
  const [complexCalculation, setComplexCalculation] =
    useState<ComplexCalculation>({
      targetBlockNumber: 0,
      targetBlockHash: "",
      byteHex: "",
      adjustedRanBlockPos: 0,
      randomBlockNumber: 0,
      randomBlockHash: "",
    });

  // ✅ UPDATED: Wallet-scoped localStorage read function
  const getStoredGuessData = (guessId: number): StoredGuessData | null => {
    try {
      // Get current wallet address
      const currentWallet = connectedAccount || localStorage.getItem("currentAccount");

      // ✅ 1) Try wallet-scoped aggregate store first
      const aggKey = getWalletStorageKey("allGuessSubmissions", currentWallet);
      const aggRaw = localStorage.getItem(aggKey);
      if (aggRaw) {
        const parsed = JSON.parse(aggRaw);
        const list: StoredGuessData[] = Array.isArray(parsed)
          ? parsed
          : Object.values(parsed || {});
        const found = list.find(
          (x) => Number(x.Sno || x.guessId) === guessId
        );
        if (found) return found;
      }

      // ✅ 2) Try wallet-scoped last guess
      if (currentWallet) {
        const lastKey = getWalletStorageKey("lastGuessSubmission", currentWallet);
        const lastRaw = localStorage.getItem(lastKey);
        if (lastRaw) {
          const data: StoredGuessData = JSON.parse(lastRaw);
          if (Number(data.guessId || data.Sno) === guessId) {
            return data;
          }
        }

        // ✅ 3) Try Firebase-style per-ID key (wallet-scoped)
        const storageKey = `guesses/${currentWallet}/${guessId}`;
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          return JSON.parse(raw);
        }
      }

      // ✅ 4) LEGACY FALLBACK: Try old non-scoped keys for backward compatibility
      const oldAggRaw = localStorage.getItem("allGuessSubmissions");
      if (oldAggRaw) {
        const parsed = JSON.parse(oldAggRaw);
        const list: StoredGuessData[] = Array.isArray(parsed)
          ? parsed
          : Object.values(parsed || {});
        const found = list.find(
          (x) => Number(x.Sno || x.guessId) === guessId
        );
        if (found) return found;
      }

      const oldLastRaw = localStorage.getItem("lastGuessSubmission");
      if (oldLastRaw) {
        const data: StoredGuessData = JSON.parse(oldLastRaw);
        if (Number(data.guessId || data.Sno) === guessId) {
          return data;
        }
      }

      return null;
    } catch (error) {
      console.error("Error reading stored guess data:", error);
      return null;
    }
  };

  // Load guess data on mount
  useEffect(() => {
    const data = getStoredGuessData(guessId);
    if (data) {
      setStoredGuessData(data);
      setTokenSize(data.tokenSize || 3);

      // Use contractBlockNumber if available, else fallback to blockIncrementCount
      const targetBlock = Number(
        data.contractBlockNumber || data.blockIncrementCount || 0
      );
      setTargetBlockCount(targetBlock);
    } else {
      setAlertMessage({
        type: "warning",
        message: `No stored guess data found for Guess ID ${guessId}. Please submit a guess first.`,
      });
    }
  }, [guessId, connectedAccount]); // ✅ Added connectedAccount dependency

  // Fetch current block number
  useEffect(() => {
    const fetchCurrentBlock = async () => {
      try {
        const web3 = new Web3(
          "https://polygon-amoy.infura.io/v3/c6e4bda19e61492da2ded0db85e1469b"
        );
        const blockNumber = await web3.eth.getBlockNumber();
        setCurrentBlockNumber(Number(blockNumber));
      } catch (error) {
        console.error("Error fetching current block:", error);
      }
    };

    fetchCurrentBlock();
    const interval = setInterval(fetchCurrentBlock, 10000);
    return () => clearInterval(interval);
  }, []);

  // Calculate block range indication
  useEffect(() => {
    if (targetBlockCount && currentBlockNumber > 0) {
      const distance = targetBlockCount - currentBlockNumber;
      let indication: BlockRangeIndication["indication"] = "dark green";
      let color = "#10b981";

      if (distance > 0) {
        if (distance > 100) {
          indication = "dark red";
          color = "#dc2626";
        } else {
          indication = "light red";
          color = "#f87171";
        }
      } else {
        const absDist = Math.abs(distance);
        if (absDist <= 100) {
          indication = "light green";
          color = "#4ade80";
        } else {
          indication = "dark green";
          color = "#10b981";
        }
      }

      setBlockRangeIndication({ blockDistance: distance, indication, color });
    }
  }, [targetBlockCount, currentBlockNumber]);

  const handleVerify = async () => {
    if (!storedGuessData) {
      setAlertMessage({
        type: "error",
        message: "No guess data found to verify.",
      });
      return;
    }

    if (!targetBlockCount) {
      setAlertMessage({
        type: "error",
        message: "Target block number not available.",
      });
      return;
    }

    if (currentBlockNumber < targetBlockCount) {
      setAlertMessage({
        type: "warning",
        message: `Target block ${targetBlockCount} has not been mined yet. Current block: ${currentBlockNumber}`,
      });
      return;
    }

    setIsVerifying(true);
    setAlertMessage(null);

    try {
      const web3 = new Web3(
        "https://polygon-amoy.infura.io/v3/c6e4bda19e61492da2ded0db85e1469b"
      );

      let finalBlockHash: string;
      let finalBlockNumber: number;

      if (storedGuessData.complex) {
        // Complex calculation
        const targetBlock = await web3.eth.getBlock(targetBlockCount);
        if (!targetBlock || !targetBlock.hash) {
          throw new Error(`Target block ${targetBlockCount} not found`);
        }

        const targetBlockHashStr = targetBlock.hash.toString();
        const byteHex = targetBlockHashStr.slice(2, 4);
        const byteValue = parseInt(byteHex, 16);
        const ranBlockPos = (byteValue % 100) + 1;
        const adjustedRanBlockPos = targetBlockCount - ranBlockPos;

        const randomBlock = await web3.eth.getBlock(adjustedRanBlockPos);
        if (!randomBlock || !randomBlock.hash) {
          throw new Error(`Random block ${adjustedRanBlockPos} not found`);
        }

        finalBlockHash = randomBlock.hash.toString();
        finalBlockNumber = adjustedRanBlockPos;

        setComplexCalculation({
          targetBlockNumber: targetBlockCount,
          targetBlockHash: targetBlockHashStr,
          byteHex: byteHex,
          adjustedRanBlockPos: adjustedRanBlockPos,
          randomBlockNumber: adjustedRanBlockPos,
          randomBlockHash: finalBlockHash,
        });
      } else {
        // Simple verification
        const block = await web3.eth.getBlock(targetBlockCount);
        if (!block || !block.hash) {
          throw new Error(`Block ${targetBlockCount} not found`);
        }
        finalBlockHash = block.hash.toString();
        finalBlockNumber = targetBlockCount;
      }

      setFetchedBlockHash(finalBlockHash);

      // Compare tokens
      const userTokens = storedGuessData.tokens || [];
      const fetchedTokens = finalBlockHash
        .replace("0x", "")
        .substring(0, tokenSize * userTokens.length)
        .match(new RegExp(`.{1,${tokenSize}}`, "g")) || [];

      const isMatch =
        userTokens.length === fetchedTokens.length &&
        userTokens.every((token, i) => token === fetchedTokens[i]);

      setMatchResult(isMatch);
      setShowMatchDetails(true);

      if (isMatch) {
        setAlertMessage({
          type: "success",
          message: "Verification successful! Your guess matches the blockchain hash.",
        });

        // ✅ UPDATED: Save match data with wallet-scoped key
        const currentWallet = connectedAccount || localStorage.getItem("currentAccount");
        const matchData = {
          guessId,
          actualHash: storedGuessData.actualHash,
          fetchedHash: finalBlockHash,
          tokenSize,
          targetBlockNumber: finalBlockNumber,
          storedGuessData,
          blockDistance: blockRangeIndication.blockDistance,
          matchResult: isMatch,
          verifiedAt: Date.now(),
          complex: storedGuessData.complex,
          complexCalculation: storedGuessData.complex ? complexCalculation : null,
        };

        const matchDataKey = getWalletStorageKey("matchData", currentWallet);
        localStorage.setItem(matchDataKey, JSON.stringify(matchData));

        // Also save to Firebase
        const matchRef = ref(
          database,
          `verifications/${currentWallet}/${guessId}/offchain`
        );
        set(matchRef, matchData).catch((err) => {
          console.error("Firebase storage error:", err);
        });
      } else {
        setAlertMessage({
          type: "error",
          message: "Verification failed! Your guess does not match the blockchain hash.",
        });
      }
    } catch (error: any) {
      console.error("Verification error:", error);
      setAlertMessage({
        type: "error",
        message: error.message || "An error occurred during verification.",
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleProceedToOnChain = () => {
    if (matchResult) {
      navigate(`/verify-onchain/${guessId}`);
    }
  };

  const handleBack = () => {
    navigate("/dashboard");
  };

  // UI rendering functions
  const renderUserTokens = () => {
    if (!storedGuessData?.tokens) return null;
    return storedGuessData.tokens.map((token, index) => (
      <motion.div
        key={index}
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: index * 0.05 }}
        className="relative group"
      >
        <div className="bg-gradient-to-br from-blue-500/20 to-purple-500/20 backdrop-blur-sm border border-blue-400/30 rounded-lg p-3 hover:border-blue-400/60 transition-all duration-300">
          <div className="flex items-center gap-2">
            <Hammer className="w-4 h-4 text-blue-400" />
            <span className="font-mono text-sm text-blue-100">{token}</span>
          </div>
        </div>
      </motion.div>
    ));
  };

  const renderFetchedTokens = () => {
    if (!fetchedBlockHash) return null;
    const userTokens = storedGuessData?.tokens || [];
    const fetchedTokens =
      fetchedBlockHash
        .replace("0x", "")
        .substring(0, tokenSize * userTokens.length)
        .match(new RegExp(`.{1,${tokenSize}}`, "g")) || [];

    return fetchedTokens.map((token, index) => {
      const isMatching = userTokens[index] === token;
      return (
        <motion.div
          key={index}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: index * 0.05 }}
          className="relative group"
        >
          <div
            className={`backdrop-blur-sm border rounded-lg p-3 transition-all duration-300 ${
              isMatching
                ? "bg-gradient-to-br from-green-500/20 to-emerald-500/20 border-green-400/30 hover:border-green-400/60"
                : "bg-gradient-to-br from-red-500/20 to-orange-500/20 border-red-400/30 hover:border-red-400/60"
            }`}
          >
            <div className="flex items-center gap-2">
              {isMatching ? (
                <CheckCircle className="w-4 h-4 text-green-400" />
              ) : (
                <XCircle className="w-4 h-4 text-red-400" />
              )}
              <span
                className={`font-mono text-sm ${
                  isMatching ? "text-green-100" : "text-red-100"
                }`}
              >
                {token}
              </span>
            </div>
          </div>
        </motion.div>
      );
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-blue-900 p-4 md:p-8 font-mono">
      {/* Background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -left-1/4 w-1/2 h-1/2 bg-purple-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 -right-1/4 w-1/2 h-1/2 bg-blue-500/10 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      <div className="max-w-6xl mx-auto relative z-10">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-4 mb-8"
        >
          <button
            onClick={handleBack}
            className="p-3 bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-lg hover:bg-gray-700/50 transition-all duration-300 group"
          >
            <ArrowLeft className="w-5 h-5 text-gray-300 group-hover:text-white transition-colors" />
          </button>
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400">
              Off-Chain Verification
            </h1>
            <p className="text-gray-400 mt-1">
              Verify your guess against the blockchain hash
            </p>
          </div>
        </motion.div>

        {/* Alert Message */}
        <AnimatePresence>
          {alertMessage && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className={`mb-6 p-4 rounded-lg border backdrop-blur-sm ${
                alertMessage.type === "success"
                  ? "bg-green-500/10 border-green-500/30 text-green-300"
                  : alertMessage.type === "error"
                  ? "bg-red-500/10 border-red-500/30 text-red-300"
                  : alertMessage.type === "warning"
                  ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-300"
                  : "bg-blue-500/10 border-blue-500/30 text-blue-300"
              }`}
            >
              <div className="flex items-center gap-3">
                {alertMessage.type === "success" ? (
                  <CheckCircle className="w-5 h-5" />
                ) : alertMessage.type === "error" ? (
                  <XCircle className="w-5 h-5" />
                ) : (
                  <AlertTriangle className="w-5 h-5" />
                )}
                <p>{alertMessage.message}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Content */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Left Column - Guess Info */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-6"
          >
            {/* Guess Details Card */}
            <div className="bg-gray-800/30 backdrop-blur-sm border border-gray-700/50 rounded-xl p-6">
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <Hash className="w-5 h-5 text-purple-400" />
                Guess Details
              </h2>

              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Guess ID</span>
                  <span className="text-white font-bold">#{guessId}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Target Block</span>
                  <span className="text-white font-bold">
                    {targetBlockCount
                      ? targetBlockCount.toLocaleString()
                      : "..."}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Token Size</span>
                  <span className="text-white font-bold">{tokenSize}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Type</span>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold ${
                      storedGuessData?.complex
                        ? "bg-orange-500/20 text-orange-300 border border-orange-500/30"
                        : "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                    }`}
                  >
                    {storedGuessData?.complex ? "Complex" : "Simple"}
                  </span>
                </div>
              </div>
            </div>

            {/* Block Status Card */}
            {currentBlockNumber > 0 && targetBlockCount && (
              <div className="bg-gray-800/30 backdrop-blur-sm border border-gray-700/50 rounded-xl p-6">
                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                  <Cpu className="w-5 h-5 text-blue-400" />
                  Block Status
                </h2>

                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">Current Block</span>
                    <span className="text-white font-bold">
                      {currentBlockNumber.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">Block Distance</span>
                    <span
                      className="font-bold"
                      style={{ color: blockRangeIndication.color }}
                    >
                      {blockRangeIndication.blockDistance} blocks
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-400">Status</span>
                    <span
                      className="px-3 py-1 rounded-full text-xs font-bold"
                      style={{
                        backgroundColor: `${blockRangeIndication.color}20`,
                        color: blockRangeIndication.color,
                        border: `1px solid ${blockRangeIndication.color}30`,
                      }}
                    >
                      {blockRangeIndication.indication}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Complex Calculation Details */}
            {storedGuessData?.complex && showMatchDetails && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-gray-800/30 backdrop-blur-sm border border-gray-700/50 rounded-xl p-6"
              >
                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                  <Zap className="w-5 h-5 text-yellow-400" />
                  Complex Calculation
                </h2>

                <div className="space-y-3 text-sm">
                  <div>
                    <span className="text-gray-400">Target Block</span>
                    <div className="text-white font-mono mt-1">
                      {complexCalculation.targetBlockNumber}
                    </div>
                  </div>
                  <div>
                    <span className="text-gray-400">Byte Hex</span>
                    <div className="text-white font-mono mt-1">
                      {complexCalculation.byteHex}
                    </div>
                  </div>
                  <div>
                    <span className="text-gray-400">Adjusted Position</span>
                    <div className="text-white font-mono mt-1">
                      {complexCalculation.adjustedRanBlockPos}
                    </div>
                  </div>
                  <div>
                    <span className="text-gray-400">Random Block</span>
                    <div className="text-white font-mono mt-1">
                      {complexCalculation.randomBlockNumber}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </motion.div>

          {/* Right Column - Tokens & Actions */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-6"
          >
            {/* Your Guess Tokens */}
            {storedGuessData?.tokens && (
              <div className="bg-gray-800/30 backdrop-blur-sm border border-gray-700/50 rounded-xl p-6">
                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                  <Hammer className="w-5 h-5 text-blue-400" />
                  Your Guess Tokens
                </h3>
                <div className="grid grid-cols-2 gap-3">{renderUserTokens()}</div>
              </div>
            )}

            {/* Fetched Block Tokens */}
            {showMatchDetails && fetchedBlockHash && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-gray-800/30 backdrop-blur-sm border border-gray-700/50 rounded-xl p-6"
              >
                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                  <Search className="w-5 h-5 text-green-400" />
                  Fetched Block Tokens
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {renderFetchedTokens()}
                </div>
              </motion.div>
            )}

            {/* Action Buttons */}
            <div className="space-y-3">
              <button
                onClick={handleVerify}
                disabled={
                  isVerifying ||
                  !storedGuessData ||
                  currentBlockNumber < (targetBlockCount || 0)
                }
                className="w-full py-4 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 disabled:from-gray-600 disabled:to-gray-700 text-white font-bold rounded-lg transition-all duration-300 flex items-center justify-center gap-2 disabled:cursor-not-allowed"
              >
                {isVerifying ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Verifying...
                  </>
                ) : (
                  <>
                    <Search className="w-5 h-5" />
                    Verify Off-Chain
                  </>
                )}
              </button>

              {matchResult && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  onClick={handleProceedToOnChain}
                  className="w-full py-4 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white font-bold rounded-lg transition-all duration-300 flex items-center justify-center gap-2"
                >
                  <Zap className="w-5 h-5" />
                  Proceed to On-Chain Verification
                </motion.button>
              )}
            </div>

            {/* Hash Details */}
            {storedGuessData && (
              <div className="bg-gray-800/30 backdrop-blur-sm border border-gray-700/50 rounded-xl p-6 space-y-4">
                <div>
                  <label className="text-gray-400 text-sm mb-2 block">
                    Actual Hash (Your Guess)
                  </label>
                  <div className="bg-gray-900/50 border border-gray-700/50 rounded-lg p-3 font-mono text-xs text-gray-300 break-all">
                    {storedGuessData.actualHash}
                  </div>
                </div>
                <div>
                  <label className="text-gray-400 text-sm mb-2 block">
                    Secret Key
                  </label>
                  <div className="bg-gray-900/50 border border-gray-700/50 rounded-lg p-3 font-mono text-xs text-gray-300 break-all">
                    {storedGuessData.secretKey}
                  </div>
                </div>
                <div>
                  <label className="text-gray-400 text-sm mb-2 block">
                    Dummy Hash
                  </label>
                  <div className="bg-gray-900/50 border border-gray-700/50 rounded-lg p-3 font-mono text-xs text-gray-300 break-all">
                    {storedGuessData.dummyHash}
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default VerifyOffChain;
