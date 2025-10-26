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
  targetBlockNumber: bigint | string | number;
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

  // Helper function to safely convert various types to number
  const safeToNumber = (value: bigint | string | number | undefined): number => {
    if (value === undefined || value === null) return 0;
    
    if (typeof value === 'bigint') {
      return Number(value);
    }
    
    if (typeof value === 'string') {
      // Handle hex strings
      if (value.startsWith('0x')) {
        return parseInt(value, 16);
      }
      return parseInt(value, 10);
    }
    
    return Number(value);
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
        throw new Error("Logic contract address not found. Please register/login first.");
      }

      console.log("🔗 Contract address:", logicCrtAddress);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const logicContract = new web3.eth.Contract(
        LOGIC_CONTRACT_ABI as any,
        logicCrtAddress
      );

      // CRITICAL FIX: Validate and format all parameters correctly
      
      // 1. Format actualHash - ensure 0x prefix and 66 characters
      let actualHashFormatted = actualHash.trim();
      if (!actualHashFormatted.startsWith("0x")) {
        actualHashFormatted = `0x${actualHashFormatted}`;
      }
      // Pad if too short
      if (actualHashFormatted.length < 66) {
        actualHashFormatted = actualHashFormatted.padEnd(66, '0');
      }
      if (actualHashFormatted.length !== 66) {
        throw new Error(`Invalid actualHash format. Length: ${actualHashFormatted.length}, expected: 66`);
      }

      // 2. Format secretKey
      let secretKeyFormatted = storedGuessData.secretKey.trim();
      if (!secretKeyFormatted.startsWith("0x")) {
        secretKeyFormatted = `0x${secretKeyFormatted}`;
      }
      if (secretKeyFormatted.length < 66) {
        secretKeyFormatted = secretKeyFormatted.padEnd(66, '0');
      }

      // 3. Format encoded match data as bytes[2] array
      let encodedMatchFormatted = encodedMatchData.trim();
      if (!encodedMatchFormatted.startsWith("0x")) {
        encodedMatchFormatted = `0x${encodedMatchFormatted}`;
      }
      if (encodedMatchFormatted.length < 66) {
        encodedMatchFormatted = encodedMatchFormatted.padEnd(66, '0');
      }

      // Create bytes[2] array - both elements are the same encoded match
      const encyDataArray = [encodedMatchFormatted, encodedMatchFormatted];

      console.log("=== 📝 Verification Parameters ===");
      console.log("Guess ID (Sno):", guessId);
      console.log("Actual Hash:", actualHashFormatted);
      console.log("Secret Key:", secretKeyFormatted);
      console.log("Ency Data:", encyDataArray);
      console.log("================================");

      // CRITICAL: Verify contract state with better error handling
      showAlert("info", "Checking Contract", "Validating guess entry...");
      
      try {
        console.log("🔍 Calling getGuessEntry with guessId:", guessId);
        
        // Use call() with explicit from parameter
        const guessEntryResult = await logicContract.methods
          .getGuessEntry(guessId)
          .call({ from: connectedAccount });

        console.log("✅ Raw contract response:", guessEntryResult);

        // Handle different response formats
        let targetBlockNum = 0;
        let targetVerifiedNum = 0;

        if (Array.isArray(guessEntryResult)) {
          // Response is an array [targetBlockNumber, targetVerified, ...]
          targetBlockNum = safeToNumber(guessEntryResult[0]);
          targetVerifiedNum = safeToNumber(guessEntryResult[1]);
        } else if (typeof guessEntryResult === 'object') {
          // Response is an object with named properties
          const entry = guessEntryResult as GuessEntry;
          targetBlockNum = safeToNumber(entry.targetBlockNumber || entry['0']);
          targetVerifiedNum = safeToNumber(entry.targetVerified || entry['1']);
        }

        console.log("📊 Parsed values:");
        console.log("  Target Block:", targetBlockNum);
        console.log("  Verified Status:", targetVerifiedNum);

        // Validate guess exists
        if (targetBlockNum === 0) {
          throw new Error(
            "Guess not found in contract. Please ensure you've submitted your guess first."
          );
        }

        // Check if already verified
        if (targetVerifiedNum !== 0) {
          throw new Error(
            "This guess has already been verified on-chain. Check your dashboard."
          );
        }

        console.log("✅ Contract validation passed!");

      } catch (checkError: unknown) {
        const errorMessage = checkError instanceof Error 
          ? checkError.message 
          : String(checkError);
        
        console.error("❌ Contract check failed:", errorMessage);

        // Better error messages
        if (errorMessage.includes("already verified")) {
          throw new Error("This guess has already been verified on-chain.");
        } else if (errorMessage.includes("not found")) {
          throw new Error("Guess not found in contract. Please submit your guess first.");
        } else if (errorMessage.includes("execution reverted")) {
          throw new Error("Contract validation failed. Your guess may not exist or data is invalid.");
        } else if (errorMessage.includes("Internal JSON-RPC")) {
          throw new Error(
            "Network error communicating with Polygon Amoy. Please:\n" +
            "1. Check your internet connection\n" +
            "2. Verify you're on Polygon Amoy Testnet\n" +
            "3. Try again in a few moments\n" +
            "4. Switch MetaMask RPC if issue persists"
          );
        }
        
        throw checkError;
      }

      // Gas estimation with fallback
      showAlert("info", "Estimating Gas", "Calculating transaction cost...");
      
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
        const errorMessage = estimateError instanceof Error 
          ? estimateError.message 
          : String(estimateError);
        
        console.warn("⚠️ Gas estimation failed:", errorMessage);
        
        // Parse specific errors
        if (errorMessage.includes("target block not reached")) {
          throw new Error("Target block hasn't been mined yet. Please wait a few more blocks.");
        } else if (errorMessage.includes("invalid hash")) {
          throw new Error("Invalid hash provided. Please verify your guess data is correct.");
        }
        
        console.warn("Using default gas limit:", gasEstimate);
      }

      const adjustedGas = Math.floor(safeToNumber(gasEstimate) * 1.3);
      console.log("⛽ Adjusted gas limit:", adjustedGas);

      showAlert("info", "Confirm Transaction", "Please confirm the transaction in your wallet...");

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
          console.log("📝 Transaction hash:", hash);
          showAlert("info", "Transaction Submitted", `Tx: ${hash.substring(0, 10)}...`);
        })
        .on("receipt", (receipt: any) => {
          console.log("✅ Transaction receipt:", receipt);
          
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
                  `🎉 Rewards: ${rewardsInEther} tokens minted!`
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
              "The transaction was unsuccessful. Please check the details and try again."
            );
          }
        })
        .on("error", (error: any) => {
          console.error("❌ Transaction error:", error);
          handleTransactionError(error);
        });

      // Clear localStorage after successful verification
      if (receipt && receipt.status) {
        setTimeout(() => {
          localStorage.removeItem("matchData");
        }, 3000);
      }

    } catch (error: unknown) {
      console.error("❌ Verification error:", error);
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
      showAlert("warning", "Transaction Rejected", "You rejected the transaction in your wallet.");
    } else if (error.code === -32603 || error.message?.includes("Internal JSON-RPC error")) {
      showAlert(
        "error",
        "Network Error",
        "Polygon Amoy testnet RPC error. The network may be experiencing issues.\n\n" +
        "Solutions:\n" +
        "• Wait 2-3 minutes and try again\n" +
        "• Check you have test MATIC for gas fees\n" +
        "• Verify you're on Polygon Amoy Testnet\n" +
        "• Try switching MetaMask RPC endpoint in settings\n" +
        "• Get test MATIC: https://faucet.polygon.technology/"
      );
    } else if (error.message?.includes("revert")) {
      const revertMatch = error.message.match(/revert (.+?)(?:"|$)/);
      const revertReason = revertMatch 
        ? revertMatch[1] 
        : "Contract rejected the transaction";
      showAlert(
        "error",
        "Verification Rejected",
        `${revertReason}\n\nPossible reasons:\n` +
        "• Guess already verified\n" +
        "• Invalid parameters\n" +
        "• Target block not reached\n" +
        "• Guess not found in contract"
      );
    } else if (error.message?.includes("insufficient funds")) {
      showAlert(
        "error",
        "Insufficient Funds",
        "You don't have enough MATIC for gas fees.\n\n" +
        "Get test MATIC from:\nhttps://faucet.polygon.technology/"
      );
    } else if (error.message?.includes("nonce")) {
      showAlert(
        "error",
        "Nonce Error",
        "Transaction nonce error. Reset your MetaMask:\n" +
        "Settings > Advanced > Clear activity tab data"
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
      console.log("✅ Firebase updated successfully");
    } catch (error) {
      console.error("❌ Firebase update error:", error);
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
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900 text-white p-6">
      {/* Alert Modal */}
      <AnimatePresence>
        {alertMessage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={handleCloseAlert}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className={`max-w-md w-full bg-gradient-to-br ${
                getAlertStyles(alertMessage.type).bgClass
              } border ${
                getAlertStyles(alertMessage.type).borderClass
              } rounded-2xl p-6 shadow-2xl`}
            >
              <div className="flex items-start gap-4">
                <div
                  className={`${
                    getAlertStyles(alertMessage.type).iconBgClass
                  } p-3 rounded-full`}
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
                <div className="flex-1">
                  <h3
                    className={`text-xl font-bold ${
                      getAlertStyles(alertMessage.type).titleColorClass
                    } mb-2`}
                  >
                    {alertMessage.title}
                  </h3>
                  <p className="text-gray-300 whitespace-pre-line">
                    {alertMessage.message}
                  </p>
                </div>
              </div>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleCloseAlert}
                className={`w-full mt-6 px-6 py-3 ${
                  getAlertStyles(alertMessage.type).buttonClass
                } text-white font-bold rounded-lg transition-all`}
              >
                OK
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto">
        {/* Back Button */}
        <motion.button
          whileHover={{ scale: 1.05, x: -5 }}
          whileTap={{ scale: 0.95 }}
          onClick={handleBack}
          className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-colors"
        >
          <ArrowLeft size={20} />
          Back to Off-Chain Verification
        </motion.button>

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-8"
        >
          <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent mb-2">
            On-Chain Verification
          </h1>
          <p className="text-gray-400">Verify your matches and claim rewards</p>
        </motion.div>

        {/* Success Banner */}
        {verificationStatus === "success" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-gradient-to-r from-emerald-500/20 to-green-500/20 border border-emerald-500/50 rounded-xl p-6 mb-6"
          >
            <div className="flex items-center gap-3">
              <Zap size={32} className="text-emerald-400" />
              <div>
                <h3 className="text-2xl font-bold text-emerald-300">
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
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-black/30 border border-gray-700 rounded-xl p-6 mb-6"
        >
          <div className="space-y-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Hash size={20} className="text-blue-400" />
                <h3 className="text-lg font-semibold text-blue-300">
                  Block Hash (Generated)
                </h3>
              </div>
              <div className="bg-gray-800/50 p-3 rounded-lg font-mono text-sm break-all">
                {fetchedHash ? `0x${fetchedHash}` : "Loading..."}
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2">
                <Hash size={20} className="text-purple-400" />
                <h3 className="text-lg font-semibold text-purple-300">
                  Actual Hash (Your Guess)
                </h3>
              </div>
              <div className="bg-gray-800/50 p-3 rounded-lg font-mono text-sm break-all">
                {actualHash ? `0x${actualHash}` : "Loading..."}
              </div>
            </div>

            {storedGuessData?.secretKey && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Hash size={20} className="text-green-400" />
                  <h3 className="text-lg font-semibold text-green-300">
                    Secret Key
                  </h3>
                </div>
                <div className="bg-gray-800/50 p-3 rounded-lg font-mono text-sm break-all">
                  {storedGuessData.secretKey}
                </div>
              </div>
            )}
          </div>
        </motion.div>

        {/* Matched Tokens */}
        {matchedTokens.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-black/30 border border-gray-700 rounded-xl p-6 mb-6"
          >
            <h3 className="text-xl font-bold text-green-300 mb-2">
              Matched Tokens: {matchedTokens.length} Found
            </h3>
            <p className="text-gray-400 text-sm mb-4">
              Select up to 2 matches to verify on-chain
            </p>

            <div className="space-y-3">
              {matchedTokens.map((token, index) => (
                <motion.div
                  key={index}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
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
                    <div className="text-xs text-gray-400">
                      Match #{index + 1}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Transaction Hash */}
        {txHash && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-black/30 border border-gray-700 rounded-xl p-6 mb-6"
          >
            <h3 className="text-lg font-semibold text-blue-300 mb-3">
              Transaction Details
            </h3>
            <div className="bg-gray-800/50 p-3 rounded-lg font-mono text-sm break-all mb-3">
              {txHash}
            </div>
            <a
              href={`https://www.oklink.com/amoy/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-purple-400 hover:text-purple-300 transition-colors"
            >
              <ExternalLink size={16} />
              View on PolygonScan
            </a>
          </motion.div>
        )}

        {/* Verify Button */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={verifyOnChain}
          disabled={isClaiming || selectedMatches.length === 0 || verificationStatus === "success"}
          className={`w-full py-4 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-3 ${
            isClaiming
              ? "bg-yellow-500/50 cursor-wait"
              : verificationStatus === "success"
              ? "bg-green-500 cursor-not-allowed"
              : selectedMatches.length === 0
              ? "bg-gray-700 cursor-not-allowed"
              : "bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
          }`}
        >
          {isClaiming ? (
            <>
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              >
                <Hammer size={24} />
              </motion.div>
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
        </motion.button>

        {selectedMatches.length === 0 && verificationStatus !== "success" && (
          <p className="text-center text-gray-400 text-sm mt-3">
            Please select at least one match to verify
          </p>
        )}
      </div>
    </div>
  );
};

export default VerifyOnChain;
