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
  complex: boolean;
  matches: string[];
  encodedMatch: string;
}

interface AlertMessage {
  type: "success" | "error" | "warning" | "info";
  title: string;
  message: string;
  onConfirm?: () => void;
}

// Contract return type for getGuessEntry
interface GuessEntry {
  targetBlockNumber: bigint | string;
  targetVerified: bigint | string | number;
  actualHash?: string;
  secretKey?: string;
  [key: string]: unknown;
}

const VerifyOnChain: React.FC = () => {
  const { guessId: guessIdFromParams } = useParams<{ guessId: string }>();
  const guessId = parseInt(guessIdFromParams || "1", 10);
  const navigate = useNavigate();
  const location = useLocation();
  const { connectedAccount, isConnected } = useAuth();

  // State Management
  const [actualHash, setActualHash] = useState("");
  const [fetchedHash, setFetchedHash] = useState("");
  const [, setTokenSize] = useState(0);
  const [, setTargetBlockNumber] = useState(0);
  const [storedGuessData, setStoredGuessData] = useState<StoredGuessData | null>(null);
  const [, setBlockDistance] = useState(0);
  const [, setComplex] = useState(false);
  const [matchedTokens, setMatchedTokens] = useState<string[]>([]);
  const [encodedMatchData, setEncodedMatchData] = useState("");
  const [selectedMatches, setSelectedMatches] = useState<string[]>([]);
  const [isClaiming, setIsClaiming] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [verificationStatus, setVerificationStatus] = useState<"pending" | "success" | "failed">("pending");
  const [rewardAmount, setRewardAmount] = useState("0");
  const [alertMessage, setAlertMessage] = useState<AlertMessage | null>(null);
  const [web3Instance, setWeb3Instance] = useState<Web3 | null>(null);

  const npInfura = new Web3(
    "https://polygon-amoy.infura.io/v3/15817b570c64442b8913e5d031b6ee29"
  );

  const showAlert = (
    type: AlertMessage["type"],
    title: string,
    message: string,
    onConfirm?: () => void
  ) => {
    setAlertMessage({ type, title, message, onConfirm });
  };

  const handleCloseAlert = () => {
    if (alertMessage?.onConfirm) {
      alertMessage.onConfirm();
    }
    setAlertMessage(null);
  };

  // Helper function to convert bigint to number safely
  const bigIntToNumber = (value: bigint | string | number): number => {
    if (typeof value === 'bigint') {
      return Number(value);
    }
    if (typeof value === 'string') {
      return parseInt(value, 10);
    }
    return value;
  };

  // Load match data from location state
  useEffect(() => {
    const state = location.state as LocationState;
    if (state) {
      setActualHash(state.actualHash);
      setFetchedHash(state.fetchedHash);
      setTokenSize(state.tokenSize);
      setTargetBlockNumber(state.targetBlockNumber);
      setStoredGuessData(state.storedGuessData);
      setBlockDistance(state.blockDistance);
      setComplex(state.complex);
      setMatchedTokens(state.matches || []);
      setEncodedMatchData(state.encodedMatch || "");
      
      // Auto-select first two matches
      if (state.matches && state.matches.length > 0) {
        setSelectedMatches(state.matches.slice(0, 2));
      }
    } else {
      // Try loading from localStorage
      const matchDataStr = localStorage.getItem("matchData");
      if (matchDataStr) {
        try {
          const matchData = JSON.parse(matchDataStr);
          setActualHash(matchData.actualHash);
          setFetchedHash(matchData.fetchedHash);
          setTokenSize(matchData.tokenSize);
          setTargetBlockNumber(matchData.targetBlockNumber);
          setBlockDistance(matchData.blockDistance);
          setComplex(matchData.complex);
          setMatchedTokens(matchData.matchedTokens || []);
          setEncodedMatchData(matchData.encodedMatch || "");
          setSelectedMatches(matchData.matchedTokens?.slice(0, 2) || []);
        } catch (e) {
          console.error("Error parsing match data:", e);
        }
      } else {
        showAlert(
          "error",
          "No Match Data",
          "No match data found. Redirecting to off-chain verification.",
          () => navigate(`/verify-offchain/${guessId}`)
        );
      }
    }
  }, [location, guessId, navigate]);

  // Initialize Web3
  useEffect(() => {
    const initWeb3 = async () => {
      try {
        if (window.ethereum) {
          const web3 = new Web3(window.ethereum);
          setWeb3Instance(web3);
        }
      } catch (error) {
        console.error("Error initializing Web3:", error);
      }
    };
    initWeb3();
  }, []);

  // Handle match selection
  const handleMatchSelection = (token: string) => {
    setSelectedMatches((prev) => {
      if (prev.includes(token)) {
        return prev.filter((t) => t !== token);
      } else {
        if (prev.length >= 2) {
          showAlert(
            "warning",
            "Maximum Selection",
            "You can only select up to 2 matches."
          );
          return prev;
        }
        return [...prev, token];
      }
    });
  };

  // FIXED: Proper contract parameter validation and encoding
  const verifyOnChain = async () => {
    if (!isConnected || !connectedAccount) {
      showAlert("error", "Wallet Not Connected", "Please connect your wallet to verify.");
      return;
    }

    if (selectedMatches.length === 0) {
      showAlert("warning", "No Matches Selected", "Please select at least one match to verify.");
      return;
    }

    if (!web3Instance || !window.ethereum) {
      showAlert("error", "Web3 Error", "Web3 instance not initialized.");
      return;
    }

    if (!storedGuessData) {
      showAlert("error", "Missing Data", "Guess data not found. Please go back to off-chain verification.");
      return;
    }

    setIsClaiming(true);

    try {
      const web3 = new Web3(window.ethereum);

      // Get logic contract address
      const logicCrtAddress = localStorage.getItem("logicCrtAddress");
      if (!logicCrtAddress || logicCrtAddress === "0x") {
        throw new Error("Logic contract address not found");
      }

      console.log("Contract address:", logicCrtAddress);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const logicContract = new web3.eth.Contract(
        LOGIC_CONTRACT_ABI as any,
        logicCrtAddress
      );

      // CRITICAL FIX: Validate and format all parameters correctly
      // 1. Ensure actualHash has 0x prefix and is 66 characters (0x + 64 hex chars)
      let actualHashFormatted = actualHash.startsWith("0x") ? actualHash : `0x${actualHash}`;
      if (actualHashFormatted.length !== 66) {
        throw new Error(`Invalid actualHash length: ${actualHashFormatted.length}. Must be 66 characters (0x + 64 hex)`);
      }

      // 2. Ensure secretKey has 0x prefix
      let secretKeyFormatted = storedGuessData.secretKey.startsWith("0x")
        ? storedGuessData.secretKey
        : `0x${storedGuessData.secretKey}`;

      // 3. CRITICAL: Format encoded match data as bytes[2] array
      // Each element must be a valid bytes32 value (66 characters)
      let encodedMatchFormatted = encodedMatchData.startsWith("0x")
        ? encodedMatchData
        : `0x${encodedMatchData}`;

      // Pad encoded match if needed to make it 66 characters
      if (encodedMatchFormatted.length < 66) {
        encodedMatchFormatted = encodedMatchFormatted + "0".repeat(66 - encodedMatchFormatted.length);
      }

      // Create bytes[2] array with two elements
      const encyDataArray = [encodedMatchFormatted, encodedMatchFormatted];

      console.log("=== Verification Parameters ===");
      console.log("SNo (guessId):", guessId);
      console.log("actualHash:", actualHashFormatted);
      console.log("secretKey:", secretKeyFormatted);
      console.log("encyData array:", encyDataArray);
      console.log("==============================");

      // CRITICAL: Verify contract state before transaction
      try {
        // Check if guess exists and is in valid state
        const guessEntryResult = await logicContract.methods.getGuessEntry(guessId).call();
        
        // Type assertion for the contract response
        const guessEntry = guessEntryResult as unknown as GuessEntry;
        
        console.log("Guess entry from contract:", guessEntry);

        // Convert bigint to number for comparison
        const targetBlockNum = bigIntToNumber(guessEntry.targetBlockNumber);
        const targetVerifiedNum = bigIntToNumber(guessEntry.targetVerified);

        if (!guessEntry || targetBlockNum === 0) {
          throw new Error("Guess entry not found in contract. Please make sure you have submitted a guess first.");
        }

        // Check if already verified
        if (targetVerifiedNum !== 0) {
          throw new Error("This guess has already been verified on-chain.");
        }
      } catch (checkError: unknown) {
        const errorMessage = checkError instanceof Error ? checkError.message : String(checkError);
        console.error("Contract state check failed:", errorMessage);
        if (!errorMessage.includes("already verified")) {
          throw new Error(`Contract check failed: ${errorMessage}`);
        }
      }

      showAlert("info", "Preparing Transaction", "Validating parameters...");

      // Gas estimation with better error handling
      let gasEstimate: bigint | number = 500000; // Default fallback
      try {
        const estimateResult = await logicContract.methods
          .verifyBlockGuess(
            guessId,
            actualHashFormatted,
            secretKeyFormatted,
            encyDataArray
          )
          .estimateGas({ from: connectedAccount });

        gasEstimate = estimateResult;
        console.log("✅ Gas estimation successful:", gasEstimate);
      } catch (estimateError: unknown) {
        const errorMessage = estimateError instanceof Error ? estimateError.message : String(estimateError);
        console.error("⚠️ Gas estimation failed:", errorMessage);
        
        // Parse the error to give user helpful feedback
        if (errorMessage.includes("guess not found")) {
          throw new Error("Guess not found in contract. Please submit your guess first.");
        } else if (errorMessage.includes("already verified")) {
          throw new Error("This guess has already been verified.");
        } else if (errorMessage.includes("invalid hash")) {
          throw new Error("Invalid hash provided. Please verify your data is correct.");
        } else if (errorMessage.includes("target block not reached")) {
          throw new Error("Target block has not been reached yet. Please wait.");
        }
        
        console.warn("Using default gas limit:", gasEstimate);
      }

      const adjustedGas = Math.floor(bigIntToNumber(gasEstimate) * 1.3);
      console.log("Adjusted gas:", adjustedGas);

      showAlert("info", "Confirm Transaction", "Please confirm the transaction in MetaMask...");

      // Send transaction
      const receipt = await logicContract.methods
        .verifyBlockGuess(
          guessId,
          actualHashFormatted,
          secretKeyFormatted,
          encyDataArray
        )
        .send({
          from: connectedAccount,
          gas: adjustedGas.toString(),
        })
        .on("transactionHash", (hash: string) => {
          setTxHash(hash);
          console.log("Transaction hash:", hash);
          showAlert("info", "Transaction Submitted", `Transaction hash: ${hash.substring(0, 10)}...`);
        })
        .on("receipt", (receipt: any) => {
          console.log("Transaction receipt:", receipt);

          if (receipt.status) {
            setVerificationStatus("success");

            // Extract reward amount from events
            try {
              if (receipt.events && receipt.events.guessVerified) {
                const event = receipt.events.guessVerified;
                const rewardsTotal =
                  event.returnValues._rewardsTotal ||
                  event.returnValues.rewardsTotal ||
                  "0";
                const rewardsInEther = npInfura.utils.fromWei(
                  rewardsTotal.toString(),
                  "ether"
                );
                setRewardAmount(rewardsInEther);
                showAlert(
                  "success",
                  "Verification Successful!",
                  `Rewards: ${rewardsInEther} tokens minted successfully!`
                );
              } else {
                showAlert(
                  "success",
                  "Verification Successful!",
                  "Your guess has been verified on-chain!"
                );
              }
            } catch (eventError) {
              console.error("Error parsing events:", eventError);
              showAlert(
                "success",
                "Verification Successful!",
                "Your guess has been verified on-chain!"
              );
            }

            // Update Firebase
            updateFirebaseVerification(receipt.transactionHash, "verified");
          } else {
            setVerificationStatus("failed");
            showAlert(
              "error",
              "Transaction Failed",
              "The transaction was unsuccessful. The contract rejected the verification."
            );
          }
        })
        .on("error", (error: any) => {
          console.error("Transaction error:", error);
          handleTransactionError(error);
        });

      // Clear localStorage after successful verification
      if (receipt && receipt.status) {
        setTimeout(() => {
          localStorage.removeItem("matchData");
        }, 3000);
      }
    } catch (error: unknown) {
      console.error("Verification error:", error);
      handleTransactionError(error);
    } finally {
      setIsClaiming(false);
    }
  };

  // FIXED: Comprehensive error handling
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleTransactionError = (error: any) => {
    setVerificationStatus("failed");

    if (error.code === 4001) {
      showAlert("warning", "Transaction Rejected", "You rejected the transaction in MetaMask.");
    } else if (error.code === -32603 || error.message?.includes("Internal JSON-RPC error")) {
      showAlert(
        "error",
        "Network Error",
        "Polygon Amoy testnet RPC error. The network may be congested. Please try:\n\n1. Wait 2-3 minutes and try again\n2. Check you have test MATIC for gas\n3. Verify your data is correct\n4. Try switching MetaMask RPC endpoint"
      );
    } else if (error.message?.includes("revert")) {
      const revertMatch = error.message.match(/revert (.+?)(?:"|$)/);
      const revertReason = revertMatch ? revertMatch[1] : "Contract rejected the transaction";
      showAlert(
        "error",
        "Verification Rejected",
        `${revertReason}\n\nPossible reasons:\n• Guess already verified\n• Invalid parameters\n• Target block not reached\n• Guess not found in contract`
      );
    } else if (error.message?.includes("insufficient funds")) {
      showAlert(
        "error",
        "Insufficient Funds",
        "You don't have enough MATIC for gas fees. Get test MATIC from: https://faucet.polygon.technology/"
      );
    } else if (error.message?.includes("nonce")) {
      showAlert(
        "error",
        "Nonce Error",
        "Transaction nonce error. Reset your MetaMask account:\nSettings > Advanced > Clear activity tab data"
      );
    } else {
      showAlert(
        "error",
        "Verification Failed",
        error.message || "An unexpected error occurred. Please check your data and try again."
      );
    }

    updateFirebaseVerification("", "failed");
  };

  // Update Firebase with verification status
  const updateFirebaseVerification = async (transactionHash: string, status: string) => {
    if (!storedGuessData || !connectedAccount) return;

    try {
      const verifyRef = ref(database, `${connectedAccount}/row${guessId}`);
      await update(verifyRef, {
        targetVerified: status === "verified" ? 2 : 1,
        transactionHash: transactionHash,
        verifiedAt: Date.now(),
      });
      console.log("Firebase updated successfully");
    } catch (error) {
      console.error("Firebase update error:", error);
    }
  };

  const handleBack = () => navigate(`/verify-offchain/${guessId}`);

  const getAlertStyles = (type: AlertMessage["type"]) => {
    const IconComponent =
      type === "success"
        ? CheckCircle
        : type === "error"
        ? XCircle
        : type === "warning"
        ? AlertTriangle
        : Info;

    const bgClass =
      type === "success"
        ? "from-emerald-900/40 to-green-900/40"
        : type === "error"
        ? "from-red-900/40 to-rose-900/40"
        : type === "warning"
        ? "from-yellow-900/40 to-orange-900/40"
        : "from-blue-900/40 to-indigo-900/40";

    const borderClass =
      type === "success"
        ? "border-emerald-500/50"
        : type === "error"
        ? "border-red-500/50"
        : type === "warning"
        ? "border-yellow-500/50"
        : "border-blue-500/50";

    const titleColorClass =
      type === "success"
        ? "text-emerald-300"
        : type === "error"
        ? "text-red-300"
        : type === "warning"
        ? "text-yellow-300"
        : "text-blue-300";

    const buttonClass =
      type === "success"
        ? "bg-emerald-500 hover:bg-emerald-600"
        : type === "error"
        ? "bg-red-500 hover:bg-red-600"
        : type === "warning"
        ? "bg-yellow-500 hover:bg-yellow-600"
        : "bg-blue-500 hover:bg-blue-600";

    const iconBgClass =
      type === "success"
        ? "bg-emerald-500/20"
        : type === "error"
        ? "bg-red-500/20"
        : type === "warning"
        ? "bg-yellow-500/20"
        : "bg-blue-500/20";

    return {
      IconComponent,
      bgClass,
      borderClass,
      titleColorClass,
      buttonClass,
      iconBgClass,
    };
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 text-white p-6">
      {/* Alert Modal */}
      <AnimatePresence>
        {alertMessage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={handleCloseAlert}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className={`max-w-md w-full bg-gradient-to-br ${
                getAlertStyles(alertMessage.type).bgClass
              } border ${
                getAlertStyles(alertMessage.type).borderClass
              } rounded-2xl p-6 shadow-2xl`}
            >
              <div className="flex flex-col items-center text-center gap-4">
                <div
                  className={`p-4 rounded-full ${
                    getAlertStyles(alertMessage.type).iconBgClass
                  }`}
                >
                  {React.createElement(
                    getAlertStyles(alertMessage.type).IconComponent,
                    {
                      size: 40,
                      className: `${
                        getAlertStyles(alertMessage.type).titleColorClass
                      }`,
                    }
                  )}
                </div>
                <h3
                  className={`text-2xl font-bold ${
                    getAlertStyles(alertMessage.type).titleColorClass
                  }`}
                >
                  {alertMessage.title}
                </h3>
                <p className="text-gray-300 whitespace-pre-line">
                  {alertMessage.message}
                </p>
                <button
                  onClick={handleCloseAlert}
                  className={`w-full py-3 px-6 rounded-lg font-semibold transition-all ${
                    getAlertStyles(alertMessage.type).buttonClass
                  }`}
                >
                  OK
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto">
        {/* Back Button */}
        <button
          onClick={handleBack}
          className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-6"
        >
          <ArrowLeft size={20} />
          Back to Off-Chain Verification
        </button>

        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            On-Chain Verification
          </h1>
          <p className="text-gray-400">Verify your matches and claim rewards</p>
        </div>

        {/* Success Banner */}
        {verificationStatus === "success" && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-gradient-to-r from-green-900/40 to-emerald-900/40 border border-green-500/50 rounded-lg p-6 mb-6"
          >
            <div className="flex items-center gap-3">
              <CheckCircle size={32} className="text-green-400" />
              <div>
                <h3 className="text-xl font-bold text-green-300">
                  🎉 Verification Successful!
                </h3>
                <p className="text-gray-300">
                  Rewards: {rewardAmount} tokens minted
                </p>
              </div>
            </div>
          </motion.div>
        )}

        {/* Hash Display */}
        <div className="bg-black/30 border border-gray-700 rounded-lg p-6 mb-6 space-y-4">
          <div>
            <label className="text-sm text-gray-400 flex items-center gap-2 mb-2">
              <Hash size={16} />
              Block Hash (Generated)
            </label>
            <div className="bg-gray-800 rounded p-3 font-mono text-sm break-all">
              {fetchedHash ? `0x${fetchedHash}` : "Loading..."}
            </div>
          </div>

          <div>
            <label className="text-sm text-gray-400 flex items-center gap-2 mb-2">
              <Hash size={16} />
              Actual Hash (Your Guess)
            </label>
            <div className="bg-gray-800 rounded p-3 font-mono text-sm break-all">
              {actualHash ? `0x${actualHash}` : "Loading..."}
            </div>
          </div>

          {storedGuessData?.secretKey && (
            <div>
              <label className="text-sm text-gray-400 flex items-center gap-2 mb-2">
                <Hash size={16} />
                Secret Key
              </label>
              <div className="bg-gray-800 rounded p-3 font-mono text-sm break-all">
                {storedGuessData.secretKey}
              </div>
            </div>
          )}
        </div>

        {/* Matched Tokens */}
        {matchedTokens.length > 0 && (
          <div className="bg-black/30 border border-gray-700 rounded-lg p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold">
                Matched Tokens: {matchedTokens.length} Found
              </h3>
            </div>
            <p className="text-gray-400 mb-4">
              Select up to 2 matches to verify on-chain
            </p>
            <div className="space-y-2">
              {matchedTokens.map((token, index) => (
                <div
                  key={index}
                  onClick={() => handleMatchSelection(token)}
                  className={`flex items-center gap-3 p-4 rounded-lg border-2 transition-all cursor-pointer ${
                    selectedMatches.includes(token)
                      ? "bg-green-500/20 border-green-400"
                      : "bg-black/30 border-gray-600 hover:border-gray-500"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedMatches.includes(token)}
                    onChange={() => {}}
                    className="w-5 h-5"
                  />
                  <div className="flex-1">
                    <div className="font-mono text-sm">{token}</div>
                    <div className="text-xs text-gray-400">Match #{index + 1}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Transaction Hash */}
        {txHash && (
          <div className="bg-black/30 border border-gray-700 rounded-lg p-6 mb-6">
            <h3 className="text-lg font-bold mb-3 flex items-center gap-2">
              <ExternalLink size={20} />
              Transaction Details
            </h3>
            <div className="bg-gray-800 rounded p-3 font-mono text-sm break-all mb-3">
              {txHash}
            </div>
            <a
              href={`https://amoy.polygonscan.com/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 flex items-center gap-2"
            >
              View on PolygonScan
              <ExternalLink size={16} />
            </a>
          </div>
        )}

        {/* Verify Button */}
        <button
          onClick={verifyOnChain}
          disabled={isClaiming || selectedMatches.length === 0 || verificationStatus === "success"}
          className={`w-full py-4 rounded-lg font-bold text-lg flex items-center justify-center gap-3 transition-all ${
            isClaiming || selectedMatches.length === 0 || verificationStatus === "success"
              ? "bg-gray-600 cursor-not-allowed"
              : "bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600"
          }`}
        >
          {isClaiming ? (
            <>
              <Hammer className="animate-spin" size={24} />
              Verifying On-Chain...
            </>
          ) : verificationStatus === "success" ? (
            <>
              <CheckCircle size={24} />
              Verified Successfully!
            </>
          ) : (
            <>
              <Zap size={24} />
              Verify On-Chain & Claim Reward
            </>
          )}
        </button>

        {selectedMatches.length === 0 && verificationStatus !== "success" && (
          <p className="text-center text-gray-400 mt-4">
            Please select at least one match to verify
          </p>
        )}
      </div>
    </div>
  );
};

export default VerifyOnChain;
