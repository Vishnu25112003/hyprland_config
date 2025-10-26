// src/components/verify/VerifyOnChain.tsx

import React, { useState, useEffect } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  Hash,
  AlertTriangle,
  Zap,
  ExternalLink,
  Hammer,
  Info,
} from "lucide-react";
import Web3 from "web3";
import { useAuth } from "../../context/AuthContext";
import { database } from "../../config/firebase";
import { ref, update } from "firebase/database";
import { LOGIC_CONTRACT_ABI } from "../../config/contracts";

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
  guessId: number;
  secretKey: string;
  actualHash: string;
  tokenSize: number;
  paymentPaidBet: string;
  complex: boolean;
  contractBlockNumber?: string;
  dummyHash?: string;
}

interface LocationState {
  actualHash: string;
  fetchedHash: string;
  tokenSize: number;
  targetBlockNumber: number;
  storedGuessData: StoredGuessData;
  blockDistance: number;
  matchResult: boolean;
  verifiedAt: number;
  complex: boolean;
  complexCalculation?: any;
}

const VerifyOnChain: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const guessId = parseInt(id || "1", 10);
  const { connectedAccount } = useAuth();

  // State management
  const [matchData, setMatchData] = useState<LocationState | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<
    "idle" | "success" | "error"
  >("idle");
  const [alertMessage, setAlertMessage] = useState<{
    type: "success" | "error" | "warning" | "info";
    message: string;
  } | null>(null);
  const [txHash, setTxHash] = useState<string>("");
  const [gasUsed, setGasUsed] = useState<string>("");
  const [blockNumber, setBlockNumber] = useState<string>("");

  // ✅ UPDATED: Load match data with wallet-scoped localStorage
  useEffect(() => {
    // Get current wallet address
    const currentWallet = connectedAccount || localStorage.getItem("currentAccount");

    // Try to get data from location state first (passed from VerifyOffChain)
    if (location.state) {
      setMatchData(location.state as LocationState);
      return;
    }

    // ✅ If no location state, try wallet-scoped localStorage
    try {
      const matchDataKey = getWalletStorageKey("matchData", currentWallet);
      const storedData = localStorage.getItem(matchDataKey);
      
      if (storedData) {
        const parsed = JSON.parse(storedData);
        setMatchData(parsed);
      } else {
        // ✅ LEGACY FALLBACK: Try old non-scoped key for backward compatibility
        const oldData = localStorage.getItem("matchData");
        if (oldData) {
          const parsed = JSON.parse(oldData);
          setMatchData(parsed);
        } else {
          setAlertMessage({
            type: "warning",
            message:
              "No verification data found. Please complete off-chain verification first.",
          });
        }
      }
    } catch (error) {
      console.error("Error loading match data:", error);
      setAlertMessage({
        type: "error",
        message: "Error loading verification data.",
      });
    }
  }, [location, guessId, connectedAccount]); // ✅ Added connectedAccount dependency

  const handleVerifyOnChain = async () => {
    if (!matchData) {
      setAlertMessage({
        type: "error",
        message: "No match data available for on-chain verification.",
      });
      return;
    }

    if (!matchData.matchResult) {
      setAlertMessage({
        type: "error",
        message: "Off-chain verification failed. Cannot proceed with on-chain verification.",
      });
      return;
    }

    setIsVerifying(true);
    setAlertMessage(null);

    try {
      const registeredWallet =
        connectedAccount || localStorage.getItem("currentAccount");

      if (!registeredWallet || registeredWallet === "0x0") {
        throw new Error("No registered wallet found. Please connect your wallet first.");
      }

      const logicAddress = localStorage.getItem("logicCrtAddress");
      if (!logicAddress || logicAddress === "0x0" || logicAddress === "0x") {
        throw new Error(
          "Logic contract not found. Please complete registration first."
        );
      }

      console.log("Initiating on-chain verification...");
      console.log("Wallet:", registeredWallet);
      console.log("Logic Contract:", logicAddress);
      console.log("Guess ID:", guessId);

      if (!window.ethereum) {
        throw new Error("No wallet detected!");
      }

      const web3 = new Web3(window.ethereum);
      const logicContract = new web3.eth.Contract(
        LOGIC_CONTRACT_ABI,
        logicAddress
      );

      const { actualHash, secretKey } = matchData.storedGuessData;

      // Ensure hashes have 0x prefix
      const actualHashWith0x = actualHash.startsWith("0x")
        ? actualHash
        : "0x" + actualHash;
      const secretKeyWith0x = secretKey.startsWith("0x")
        ? secretKey
        : "0x" + secretKey;

      console.log("Calling verifyBlockGuess with:");
      console.log("- Guess ID:", guessId);
      console.log("- Actual Hash:", actualHashWith0x.substring(0, 10) + "...");
      console.log("- Secret Key:", secretKeyWith0x.substring(0, 10) + "...");

      // Prepare encrypted data (encyData)
      const encyData = web3.utils.keccak256(
        web3.utils.encodePacked(
          { value: actualHashWith0x, type: "bytes32" },
          { value: secretKeyWith0x, type: "bytes32" }
        ) || ""
      );

      console.log("Encrypted data (encyData):", encyData);

      // Call smart contract
      await logicContract.methods
        .verifyBlockGuess(guessId, actualHashWith0x, secretKeyWith0x, encyData)
        .send({
          from: registeredWallet,
          gas: "500000",
        })
        .on("transactionHash", function (hash: string) {
          console.log("Transaction hash:", hash);
          setTxHash(hash);
          setAlertMessage({
            type: "info",
            message: "Transaction submitted! Waiting for confirmation...",
          });
        })
        .on("receipt", function (receipt: any) {
          console.log("Transaction receipt:", receipt);
          setGasUsed(receipt.gasUsed?.toString() || "0");
          setBlockNumber(receipt.blockNumber?.toString() || "0");

          if (receipt.status) {
            setVerificationStatus("success");
            setAlertMessage({
              type: "success",
              message: "On-chain verification successful! Your guess has been verified on the blockchain.",
            });

            // Update Firebase with verification status
            const currentWallet = connectedAccount || localStorage.getItem("currentAccount");
            const guessRef = ref(
              database,
              `verifications/${currentWallet}/${guessId}/onchain`
            );
            update(guessRef, {
              verified: true,
              txHash: receipt.transactionHash,
              gasUsed: receipt.gasUsed?.toString(),
              blockNumber: receipt.blockNumber?.toString(),
              timestamp: Date.now(),
            }).catch((err) => {
              console.error("Firebase update error:", err);
            });

            // ✅ UPDATED: Clear wallet-scoped matchData after successful verification
            const currentWallet2 = connectedAccount || localStorage.getItem("currentAccount");
            const matchDataKey = getWalletStorageKey("matchData", currentWallet2);
            localStorage.removeItem(matchDataKey);
            
            // Also try to remove old non-scoped key if it exists
            localStorage.removeItem("matchData");
          } else {
            throw new Error("Transaction failed");
          }
        })
        .on("error", function (error: any) {
          console.error("Transaction error:", error);
          throw error;
        });
    } catch (error: any) {
      console.error("On-chain verification error:", error);

      let errorMessage = "An error occurred during on-chain verification.";

      if (
        error.message?.includes("User denied transaction signature") ||
        error.code === 4001
      ) {
        errorMessage = "User denied transaction signature.";
      } else if (
        error.message?.includes("Internal JSON-RPC error") ||
        error.code === -32603
      ) {
        errorMessage = "RPC Error: Please check gas settings and try again.";
      } else if (
        error.message?.includes("revert") ||
        error.message?.includes("execution reverted")
      ) {
        errorMessage =
          "Transaction reverted. Possible reasons:\n\n• Invalid guess data\n• Guess already verified\n• Contract validation failed";
      } else if (error.message?.includes("gas")) {
        errorMessage = "Gas estimation failed. Please check your network settings.";
      } else if (error.message) {
        errorMessage = error.message;
      }

      setVerificationStatus("error");
      setAlertMessage({
        type: "error",
        message: errorMessage,
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleBack = () => {
    navigate("/dashboard");
  };

  const handleBackToOffChain = () => {
    navigate(`/verify-offchain/${guessId}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-blue-900 p-4 md:p-8 font-mono">
      {/* Background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -left-1/4 w-1/2 h-1/2 bg-purple-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 -right-1/4 w-1/2 h-1/2 bg-blue-500/10 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      <div className="max-w-4xl mx-auto relative z-10">
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
            <h1 className="text-3xl md:text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-400 via-emerald-400 to-teal-400">
              On-Chain Verification
            </h1>
            <p className="text-gray-400 mt-1">
              Submit your verification to the blockchain
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
                <p className="whitespace-pre-line">{alertMessage.message}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Content */}
        {matchData ? (
          <div className="space-y-6">
            {/* Verification Summary Card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-gray-800/30 backdrop-blur-sm border border-gray-700/50 rounded-xl p-6"
            >
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <Hash className="w-5 h-5 text-green-400" />
                Verification Summary
              </h2>

              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Guess ID</span>
                  <span className="text-white font-bold">#{guessId}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Target Block</span>
                  <span className="text-white font-bold">
                    {matchData.targetBlockNumber.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Token Size</span>
                  <span className="text-white font-bold">
                    {matchData.tokenSize}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Block Distance</span>
                  <span className="text-white font-bold">
                    {matchData.blockDistance} blocks
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Off-Chain Status</span>
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-green-500/20 text-green-300 border border-green-500/30">
                    Verified
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Type</span>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold ${
                      matchData.complex
                        ? "bg-orange-500/20 text-orange-300 border border-orange-500/30"
                        : "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                    }`}
                  >
                    {matchData.complex ? "Complex" : "Simple"}
                  </span>
                </div>
              </div>
            </motion.div>

            {/* Hash Details Card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-gray-800/30 backdrop-blur-sm border border-gray-700/50 rounded-xl p-6"
            >
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <Hammer className="w-5 h-5 text-purple-400" />
                Hash Information
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="text-gray-400 text-sm mb-2 block">
                    Your Guess Hash
                  </label>
                  <div className="bg-gray-900/50 border border-gray-700/50 rounded-lg p-3 font-mono text-xs text-gray-300 break-all">
                    {matchData.actualHash}
                  </div>
                </div>
                <div>
                  <label className="text-gray-400 text-sm mb-2 block">
                    Fetched Block Hash
                  </label>
                  <div className="bg-gray-900/50 border border-gray-700/50 rounded-lg p-3 font-mono text-xs text-gray-300 break-all">
                    {matchData.fetchedHash}
                  </div>
                </div>
                <div>
                  <label className="text-gray-400 text-sm mb-2 block">
                    Secret Key
                  </label>
                  <div className="bg-gray-900/50 border border-gray-700/50 rounded-lg p-3 font-mono text-xs text-gray-300 break-all">
                    {matchData.storedGuessData.secretKey}
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Transaction Status Card */}
            {(verificationStatus !== "idle" || txHash) && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-gray-800/30 backdrop-blur-sm border border-gray-700/50 rounded-xl p-6"
              >
                <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                  <Zap className="w-5 h-5 text-yellow-400" />
                  Transaction Details
                </h2>

                <div className="space-y-3">
                  {txHash && (
                    <div>
                      <label className="text-gray-400 text-sm mb-2 block">
                        Transaction Hash
                      </label>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-900/50 border border-gray-700/50 rounded-lg p-3 font-mono text-xs text-gray-300 break-all">
                          {txHash}
                        </div>
                        <a
                          href={`https://amoy.polygonscan.com/tx/${txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-3 bg-blue-500/20 border border-blue-500/30 rounded-lg hover:bg-blue-500/30 transition-all"
                        >
                          <ExternalLink className="w-4 h-4 text-blue-300" />
                        </a>
                      </div>
                    </div>
                  )}
                  {gasUsed && (
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400">Gas Used</span>
                      <span className="text-white font-bold">
                        {parseInt(gasUsed).toLocaleString()}
                      </span>
                    </div>
                  )}
                  {blockNumber && (
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400">Block Number</span>
                      <span className="text-white font-bold">
                        {parseInt(blockNumber).toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* Action Buttons */}
            <div className="space-y-3">
              <button
                onClick={handleVerifyOnChain}
                disabled={isVerifying || verificationStatus === "success"}
                className="w-full py-4 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 disabled:from-gray-600 disabled:to-gray-700 text-white font-bold rounded-lg transition-all duration-300 flex items-center justify-center gap-2 disabled:cursor-not-allowed"
              >
                {isVerifying ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Verifying On-Chain...
                  </>
                ) : verificationStatus === "success" ? (
                  <>
                    <CheckCircle className="w-5 h-5" />
                    Verified Successfully
                  </>
                ) : (
                  <>
                    <Zap className="w-5 h-5" />
                    Verify On-Chain
                  </>
                )}
              </button>

              {verificationStatus !== "success" && (
                <button
                  onClick={handleBackToOffChain}
                  className="w-full py-3 bg-gray-700/50 hover:bg-gray-600/50 text-gray-300 font-bold rounded-lg transition-all duration-300 flex items-center justify-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back to Off-Chain
                </button>
              )}
            </div>

            {/* Info Box */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4"
            >
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-200">
                  <p className="font-semibold mb-1">Important Notes:</p>
                  <ul className="list-disc list-inside space-y-1 text-blue-300/80">
                    <li>This transaction will be recorded on the blockchain</li>
                    <li>Make sure you have enough MATIC for gas fees</li>
                    <li>The verification cannot be reversed once confirmed</li>
                  </ul>
                </div>
              </div>
            </motion.div>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-gray-800/30 backdrop-blur-sm border border-gray-700/50 rounded-xl p-12 text-center"
          >
            <AlertTriangle className="w-16 h-16 text-yellow-400 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-white mb-2">
              No Verification Data
            </h3>
            <p className="text-gray-400 mb-6">
              Please complete off-chain verification first before proceeding with
              on-chain verification.
            </p>
            <button
              onClick={() => navigate(`/verify-offchain/${guessId}`)}
              className="px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white font-bold rounded-lg transition-all duration-300"
            >
              Go to Off-Chain Verification
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default VerifyOnChain;
