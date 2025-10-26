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
  DollarSign,
} from "lucide-react";
import Web3 from "web3";
import { useAuth } from "../../context/AuthContext";
import { database } from "../../config/firebase";
import { ref, update } from "firebase/database";
import { LOGIC_CONTRACT_ABI, TOKEN_CONTRACT_ABI, TOKEN_CONTRACT_ADDRESS } from "../../config/contracts";

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

interface GasEstimateData {
  estimatedGas: string;
  gasPriceGwei: string;
  estimatedCostMatic: string;
  estimatedCostUSD: string;
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
  const [isEstimatingGas, setIsEstimatingGas] = useState(false);
  const [showGasConfirmation, setShowGasConfirmation] = useState(false);
  const [gasEstimate, setGasEstimate] = useState<GasEstimateData | null>(null);
  const [txHash, setTxHash] = useState("");
  const [verificationStatus, setVerificationStatus] = useState<"pending" | "success" | "failed">("pending");
  const [rewardAmount, setRewardAmount] = useState("0");
  const [tokenBalance, setTokenBalance] = useState("0");
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
      
      if (state.matches && state.matches.length > 0) {
        setSelectedMatches(state.matches.slice(0, 2));
      }
    } else {
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
          
          // Try to get stored guess data from localStorage
          const walletAddress = localStorage.getItem("currentAccount");
          if (walletAddress) {
            const walletGuessKey = `guesses_${walletAddress.toLowerCase()}`;
            const guessesRaw = localStorage.getItem(walletGuessKey);
            if (guessesRaw) {
              const guesses = JSON.parse(guessesRaw);
              const foundGuess = guesses.find((g: any) => 
                Number(g.Sno || g.guessId || g.id) === guessId
              );
              if (foundGuess) {
                setStoredGuessData(foundGuess);
              }
            }
          }
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

  // Fetch token balance
  useEffect(() => {
    const fetchBalance = async () => {
      if (!connectedAccount || !web3Instance) return;

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tokenContract = new web3Instance.eth.Contract(
          TOKEN_CONTRACT_ABI as any,
          TOKEN_CONTRACT_ADDRESS
        );

        const balance = await tokenContract.methods.balanceOf(connectedAccount).call();
        const balanceInEther = web3Instance.utils.fromWei(balance.toString(), "ether");
        setTokenBalance(balanceInEther);
      } catch (error) {
        console.error("Error fetching balance:", error);
      }
    };

    fetchBalance();
    const interval = setInterval(fetchBalance, 10000); // Update every 10 seconds
    return () => clearInterval(interval);
  }, [connectedAccount, web3Instance, verificationStatus]);

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

  // Step 1: Estimate gas and show confirmation
  const handleVerifyClick = async () => {
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

    setIsEstimatingGas(true);

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

      // Format parameters
      let actualHashFormatted = actualHash.trim();
      if (!actualHashFormatted.startsWith("0x")) {
        actualHashFormatted = `0x${actualHashFormatted}`;
      }
      if (actualHashFormatted.length < 66) {
        actualHashFormatted = actualHashFormatted.padEnd(66, '0');
      }

      let secretKeyFormatted = storedGuessData.secretKey.trim();
      if (!secretKeyFormatted.startsWith("0x")) {
        secretKeyFormatted = `0x${secretKeyFormatted}`;
      }
      if (secretKeyFormatted.length < 66) {
        secretKeyFormatted = secretKeyFormatted.padEnd(66, '0');
      }

      let encodedMatchFormatted = encodedMatchData.trim();
      if (!encodedMatchFormatted.startsWith("0x")) {
        encodedMatchFormatted = `0x${encodedMatchFormatted}`;
      }
      if (encodedMatchFormatted.length < 66) {
        encodedMatchFormatted = encodedMatchFormatted.padEnd(66, '0');
      }

      const encyDataArray = [encodedMatchFormatted, encodedMatchFormatted];

      console.log("=== 📝 Verification Parameters ===");
      console.log("Guess ID (Sno):", guessId);
      console.log("Actual Hash:", actualHashFormatted);
      console.log("Secret Key:", secretKeyFormatted);
      console.log("Ency Data:", encyDataArray);
      console.log("================================");

      // Estimate gas - this will fail if contract rejects the transaction
      console.log("⛽ Estimating gas...");
      
      let gasEstimated: bigint | number = 500000; // Default fallback
      
      try {
        const estimateResult = await logicContract.methods
          .verifyBlockGuess(
            guessId,
            actualHashFormatted,
            secretKeyFormatted,
            encyDataArray
          )
          .estimateGas({ from: connectedAccount });
        
        gasEstimated = estimateResult;
        console.log("✅ Gas estimation successful:", gasEstimated);
      } catch (estimateError: unknown) {
        const errorMessage = estimateError instanceof Error 
          ? estimateError.message 
          : JSON.stringify(estimateError);
        
        console.error("❌ Gas estimation failed:", errorMessage);
        
        // Parse specific errors from gas estimation
        if (errorMessage.includes("target block not reached") || 
            errorMessage.includes("Target block not reached")) {
          throw new Error("⏳ Target block hasn't been mined yet. Please wait a few more blocks and try again.");
        } else if (errorMessage.includes("already verified") || 
                   errorMessage.includes("Already verified")) {
          throw new Error("✅ This guess has already been verified. Check your dashboard!");
        } else if (errorMessage.includes("invalid hash") || 
                   errorMessage.includes("Invalid hash")) {
          throw new Error("❌ Invalid hash provided. Please verify your guess data is correct.");
        } else if (errorMessage.includes("Guess not found") || 
                   errorMessage.includes("not found")) {
          throw new Error("🔍 Guess not found in contract. Please submit your guess first from the Guess page.");
        } else if (errorMessage.includes("insufficient funds")) {
          throw new Error("💰 Insufficient MATIC for gas fees. Get test MATIC from: https://faucet.polygon.technology/");
        }
        
        // For generic errors, use default gas
        console.warn("⚠️ Using default gas limit:", gasEstimated);
      }

      // Get current gas price
      const gasPrice = await web3.eth.getGasPrice();
      const gasPriceGwei = web3.utils.fromWei(gasPrice.toString(), "gwei");

      // Calculate estimated cost
      const adjustedGas = Math.floor(Number(gasEstimated) * 1.3);
      const estimatedCostWei = BigInt(adjustedGas) * BigInt(gasPrice);
      const estimatedCostMatic = web3.utils.fromWei(estimatedCostWei.toString(), "ether");
      
      // Approximate USD value (assuming 1 MATIC = $0.50)
      const estimatedCostUSD = (parseFloat(estimatedCostMatic) * 0.5).toFixed(4);

      console.log("💰 Gas Estimate:");
      console.log("  Gas Units:", adjustedGas);
      console.log("  Gas Price:", gasPriceGwei, "Gwei");
      console.log("  Estimated Cost:", estimatedCostMatic, "MATIC");
      console.log("  Estimated Cost:", estimatedCostUSD, "USD");

      // Check user has enough MATIC
      const balance = await web3.eth.getBalance(connectedAccount);
      const balanceMatic = web3.utils.fromWei(balance.toString(), "ether");
      
      if (parseFloat(balanceMatic) < parseFloat(estimatedCostMatic)) {
        throw new Error(
          `💰 Insufficient MATIC!\n\n` +
          `Your Balance: ${parseFloat(balanceMatic).toFixed(4)} MATIC\n` +
          `Required: ${estimatedCostMatic} MATIC\n\n` +
          `Get test MATIC from: https://faucet.polygon.technology/`
        );
      }

      // Show gas confirmation modal
      setGasEstimate({
        estimatedGas: adjustedGas.toString(),
        gasPriceGwei: parseFloat(gasPriceGwei).toFixed(2),
        estimatedCostMatic: parseFloat(estimatedCostMatic).toFixed(6),
        estimatedCostUSD: estimatedCostUSD,
      });
      setShowGasConfirmation(true);

    } catch (error: unknown) {
      console.error("❌ Estimation error:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      showAlert("error", "Gas Estimation Failed", errorMessage);
    } finally {
      setIsEstimatingGas(false);
    }
  };

  // Step 2: Execute transaction after gas confirmation
  const executeVerification = async () => {
    setShowGasConfirmation(false);
    setIsClaiming(true);

    try {
      const web3 = new Web3(window.ethereum);
      const logicCrtAddress = localStorage.getItem("logicCrtAddress");

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const logicContract = new web3.eth.Contract(
        LOGIC_CONTRACT_ABI as any,
        logicCrtAddress as string
      );

      // Format parameters (same as estimation)
      let actualHashFormatted = actualHash.trim();
      if (!actualHashFormatted.startsWith("0x")) {
        actualHashFormatted = `0x${actualHashFormatted}`;
      }
      if (actualHashFormatted.length < 66) {
        actualHashFormatted = actualHashFormatted.padEnd(66, '0');
      }

      let secretKeyFormatted = storedGuessData!.secretKey.trim();
      if (!secretKeyFormatted.startsWith("0x")) {
        secretKeyFormatted = `0x${secretKeyFormatted}`;
      }
      if (secretKeyFormatted.length < 66) {
        secretKeyFormatted = secretKeyFormatted.padEnd(66, '0');
      }

      let encodedMatchFormatted = encodedMatchData.trim();
      if (!encodedMatchFormatted.startsWith("0x")) {
        encodedMatchFormatted = `0x${encodedMatchFormatted}`;
      }
      if (encodedMatchFormatted.length < 66) {
        encodedMatchFormatted = encodedMatchFormatted.padEnd(66, '0');
      }

      const encyDataArray = [encodedMatchFormatted, encodedMatchFormatted];

      console.log("🚀 Sending transaction...");

      showAlert("info", "Confirm in Wallet", "Please confirm the transaction in MetaMask...");

      // Send transaction
      const receipt = await logicContract.methods
        .verifyBlockGuess(
          guessId,
          actualHashFormatted,
          secretKeyFormatted,
          encyDataArray
        )
        .send({
          from: connectedAccount as string,
          gas: gasEstimate?.estimatedGas || "500000",
        })
        .on("transactionHash", (hash: string) => {
          setTxHash(hash);
          console.log("📝 Transaction hash:", hash);
          showAlert("info", "Transaction Submitted", `Tx: ${hash.substring(0, 10)}...`);
        })
        .on("receipt", (receipt: any) => {
          console.log("✅ Transaction receipt:", receipt);
          handleTransactionSuccess(receipt);
        })
        .on("error", (error: any) => {
          console.error("❌ Transaction error:", error);
          handleTransactionError(error);
        });

      console.log("✅ Verification complete!");

    } catch (error: unknown) {
      console.error("❌ Verification error:", error);
      handleTransactionError(error);
    } finally {
      setIsClaiming(false);
    }
  };

  // Handle successful transaction
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleTransactionSuccess = async (receipt: any) => {
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
            "🎉 Verification Successful!",
            `Rewards: ${rewardsInEther} GuessCoin tokens minted!\n\n` +
            `Transaction: ${receipt.transactionHash.substring(0, 10)}...`
          );
        } else {
          showAlert(
            "success",
            "✅ Verification Successful!",
            "Your guess has been verified on-chain!"
          );
        }
      } catch (eventError) {
        console.error("Error parsing events:", eventError);
        showAlert(
          "success",
          "✅ Verification Successful!",
          "Your guess has been verified on-chain!"
        );
      }

      // Update Firebase
      updateFirebaseVerification(receipt.transactionHash, "verified");

      // Clear localStorage after successful verification
      setTimeout(() => {
        localStorage.removeItem("matchData");
      }, 3000);
    } else {
      setVerificationStatus("failed");
      showAlert(
        "error",
        "Transaction Failed",
        "The transaction was unsuccessful. Please check the details and try again."
      );
      updateFirebaseVerification("", "failed");
    }
  };

  // Handle transaction errors
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleTransactionError = (error: any) => {
    setVerificationStatus("failed");

    if (error.code === 4001) {
      showAlert("warning", "Transaction Rejected", "You rejected the transaction in your wallet.");
    } else if (error.code === -32603 || error.message?.includes("Internal JSON-RPC error")) {
      showAlert(
        "error",
        "Network Error",
        "Polygon Amoy testnet RPC error.\n\n" +
        "Solutions:\n" +
        "• Check you have test MATIC for gas fees\n" +
        "• Verify you're on Polygon Amoy Testnet (Chain ID: 80002)\n" +
        "• Get test MATIC: https://faucet.polygon.technology/\n" +
        "• Try switching MetaMask RPC in Settings > Networks"
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

      {/* Gas Confirmation Modal */}
      <AnimatePresence>
        {showGasConfirmation && gasEstimate && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="max-w-md w-full bg-gradient-to-br from-purple-900/40 to-blue-900/40 border border-purple-500/50 rounded-2xl p-6 shadow-2xl"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="bg-purple-500/20 p-3 rounded-full">
                  <DollarSign size={32} className="text-purple-300" />
                </div>
                <h3 className="text-2xl font-bold text-purple-300">
                  Gas Fee Confirmation
                </h3>
              </div>

              <div className="space-y-3 mb-6">
                <div className="bg-black/30 rounded-lg p-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Estimated Gas</span>
                    <span className="text-white font-mono">
                      {gasEstimate.estimatedGas} units
                    </span>
                  </div>
                </div>

                <div className="bg-black/30 rounded-lg p-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Gas Price</span>
                    <span className="text-white font-mono">
                      {gasEstimate.gasPriceGwei} Gwei
                    </span>
                  </div>
                </div>

                <div className="bg-purple-500/20 rounded-lg p-4 border border-purple-500/50">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-300 font-semibold">
                      Estimated Cost
                    </span>
                    <div className="text-right">
                      <div className="text-xl font-bold text-purple-300">
                        {gasEstimate.estimatedCostMatic} MATIC
                      </div>
                      <div className="text-sm text-gray-400">
                        ≈ ${gasEstimate.estimatedCostUSD} USD
                      </div>
                    </div>
                  </div>
                </div>

                <div className="text-xs text-gray-400 text-center">
                  This is an estimate. Actual cost may vary slightly.
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShowGasConfirmation(false)}
                  className="px-6 py-3 bg-gray-600 hover:bg-gray-700 text-white font-bold rounded-lg transition-all"
                >
                  Cancel
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={executeVerification}
                  className="px-6 py-3 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-bold rounded-lg transition-all"
                >
                  Confirm
                </motion.button>
              </div>
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

        {/* Header with Balance */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-8"
        >
          <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent mb-2">
            On-Chain Verification
          </h1>
          <p className="text-gray-400">Verify your matches and claim rewards</p>
          
          {connectedAccount && (
            <div className="mt-4 inline-block bg-purple-500/20 border border-purple-500/50 rounded-lg px-4 py-2">
              <div className="flex items-center gap-2">
                <Zap size={16} className="text-yellow-400" />
                <span className="text-sm text-gray-300">Your Balance:</span>
                <span className="text-lg font-bold text-purple-300">
                  {parseFloat(tokenBalance).toFixed(4)} GC
                </span>
              </div>
            </div>
          )}
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
                  Rewards: {rewardAmount} GuessCoin tokens minted
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
          onClick={handleVerifyClick}
          disabled={
            isEstimatingGas ||
            isClaiming ||
            selectedMatches.length === 0 ||
            verificationStatus === "success"
          }
          className={`w-full py-4 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-3 ${
            isEstimatingGas
              ? "bg-blue-500/50 cursor-wait"
              : isClaiming
              ? "bg-yellow-500/50 cursor-wait"
              : verificationStatus === "success"
              ? "bg-green-500 cursor-not-allowed"
              : selectedMatches.length === 0
              ? "bg-gray-700 cursor-not-allowed"
              : "bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
          }`}
        >
          {isEstimatingGas ? (
            <>
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
              >
                <DollarSign size={24} />
              </motion.div>
              Estimating Gas...
            </>
          ) : isClaiming ? (
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
