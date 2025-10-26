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

interface AlertMessage {
  type: "success" | "error" | "warning" | "info";
  title: string;
  message: string;
  onConfirm?: () => void;
}

interface MatchData {
  guessId: number;
  targetBlockNumber: number;
  actualHash: string;
  fetchedHash: string;
  matchedTokens: string[];
  blockDistance: number;
  complex: boolean;
  encodedMatch: string;
  tokenSize: number;
  secretKey: string;
  paymentPaidBet: string;
}

const VerifyOffChain: React.FC = () => {
  const { guessId: guessIdFromParams } = useParams<{ guessId: string }>();
  const guessId = parseInt(guessIdFromParams || "1", 10);
  const navigate = useNavigate();
  const { connectedAccount } = useAuth();

  // State from localStorage
  const [targetBlockCount, setTargetBlockCount] = useState(0);
  const [tokenSize, setTokenSize] = useState(0);
  const [paidGuess, setPaidGuess] = useState(false);
  const [complex, setComplex] = useState(false);
  const [actualHash, setActualHash] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [dummyHash, setDummyHash] = useState("");
  const [storedGuessData, setStoredGuessData] =
    useState<StoredGuessData | null>(null);

  // Component state
  const [targetBlockHash, setTargetBlockHash] = useState("");
  const [isFetching, setIsFetching] = useState(false);
  const [web3Instance, setWeb3Instance] = useState<Web3 | null>(null);
  const [foundTokens, setFoundTokens] = useState<string[]>([]);
  const [blockRangeIndication, setBlockRangeIndication] =
    useState<BlockRangeIndication | null>(null);
  const [complexCalculation, setComplexCalculation] =
    useState<ComplexCalculation | null>(null);
  const [showComplexCalculation, setShowComplexCalculation] = useState(false);
  const [alertMessage, setAlertMessage] = useState<AlertMessage | null>(null);
  const [currentBlockNumber, setCurrentBlockNumber] = useState<number>(0);
  const [actualTokens, setActualTokens] = useState<string[]>([]);
  const [fetchedTokens, setFetchedTokens] = useState<string[]>([]);

  // Web3 Infura for reading blockchain
  const npInfura = new Web3(
    "https://polygon-amoy.infura.io/v3/15817b570c64442b8913e5d031b6ee29",
  );

  const getWalletStorageKey = (walletAddress: string, key: string): string => {
  return `${walletAddress}_${key}`;
};

const getWalletLocalStorage = (walletAddress: string, key: string): any => {
  const storageKey = getWalletStorageKey(walletAddress, key);
  const data = localStorage.getItem(storageKey);
  return data ? JSON.parse(data) : null;
};

const setWalletLocalStorage = (walletAddress: string, key: string, value: any): void => {
  const storageKey = getWalletStorageKey(walletAddress, key);
  localStorage.setItem(storageKey, JSON.stringify(value));
};

  const showAlert = (
    type: AlertMessage["type"],
    title: string,
    message: string,
    onConfirm?: () => void,
  ) => {
    setAlertMessage({ type, title, message, onConfirm });
  };

  const handleCloseAlert = () => {
    if (alertMessage?.onConfirm) {
      alertMessage.onConfirm();
    }
    setAlertMessage(null);
  };

  // Load guess data from localStorage
useEffect(() => {
  const loadGuessData = async () => {
    if (!connectedAccount) {
      console.error("No wallet connected");
      return;
    }

    try {
      setIsLoading(true);

      // UPDATED: Load from wallet-specific localStorage
      const allGuesses = getWalletLocalStorage(connectedAccount, "allGuessSubmissions") || [];
      const currentGuess = allGuesses.find((g: any) => g.guessId === guessId);

      if (currentGuess) {
        setStoredGuessData(currentGuess);
        setActualHash(currentGuess.actualHash || "");
        setSecretKey(currentGuess.secretKey || "");
        setDummyHash(currentGuess.dummyHash || "");
        setTokenSize(currentGuess.tokenSize || 3);
        setComplex(currentGuess.complex || false);
        setTargetBlockCount(currentGuess.contractBlockNumber || currentGuess.blockIncrementCount);
      } else {
        console.warn(`No guess data found for guessId: ${guessId}`);
      }

      setIsLoading(false);
    } catch (error) {
      console.error("Error loading guess data:", error);
      setIsLoading(false);
    }
  };

  loadGuessData();
}, [guessId, connectedAccount]);


  // Initialize Web3 and update block number
  useEffect(() => {
    const initWeb3 = async () => {
      try {
        const web3 = new Web3(
          "https://polygon-amoy.infura.io/v3/15817b570c64442b8913e5d031b6ee29",
        );
        setWeb3Instance(web3);

        // Get initial block number
        const blockNum = await web3.eth.getBlockNumber();
        setCurrentBlockNumber(Number(blockNum));
      } catch (error) {
        console.error("Error initializing Web3:", error);
      }
    };
    initWeb3();
  }, []);

  // Update current block every 10 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      if (web3Instance) {
        try {
          const blockNum = await web3Instance.eth.getBlockNumber();
          setCurrentBlockNumber(Number(blockNum));
        } catch (error) {
          console.error("Error updating block number:", error);
        }
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [web3Instance]);

  // Utility functions
  const removePrefix = (hexStr: string): string => {
    return hexStr.startsWith("0x") ? hexStr.slice(2) : hexStr;
  };

  const tokenize = (hexStr: string, size: number): string[] => {
    const tokens: string[] = [];
    for (let i = 0; i <= hexStr.length - size; i++) {
      tokens.push(hexStr.slice(i, i + size));
    }
    return tokens;
  };

  const findMatchingTokens = (
    hash1: string,
    hash2: string,
    size: number,
  ): string[] => {
    if (!hash1 || !hash2 || size <= 0) return [];

    const cleanHash1 = removePrefix(hash1.toLowerCase());
    const cleanHash2 = removePrefix(hash2.toLowerCase());

    const userGuessTokens = new Set<string>();
    for (let i = 0; i <= cleanHash1.length - size; i++) {
      userGuessTokens.add(cleanHash1.substring(i, i + size));
    }

    const foundMatches = new Set<string>();
    for (let i = 0; i <= cleanHash2.length - size; i++) {
      const fetchedToken = cleanHash2.substring(i, i + size);
      if (userGuessTokens.has(fetchedToken)) {
        foundMatches.add(fetchedToken);
      }
    }

    return Array.from(foundMatches);
  };

  const getRandomBlockHash = async (
    seedHash: string,
    targetBlockNumber: number,
  ) => {
    if (!web3Instance) return null;
    try {
      const cleanSeedHash = removePrefix(seedHash);
      const byteHex = cleanSeedHash.slice(30, 32);
      const ranBlockPos = parseInt(byteHex, 16);
      let adjustedRanBlockPos = ranBlockPos;

      if (adjustedRanBlockPos > 127) {
        adjustedRanBlockPos = Math.floor(adjustedRanBlockPos / 2);
      }

      const randomBlockNumber = targetBlockNumber - adjustedRanBlockPos;
      const block = await web3Instance.eth.getBlock(randomBlockNumber);

      if (block && block.hash) {
        return {
          hash: block.hash as string,
          byteHex,
          adjustedRanBlockPos,
          randomBlockNumber,
        };
      }
      return null;
    } catch (error) {
      console.error("Error getting random block hash:", error);
      return null;
    }
  };

  const calculateBlockRangeIndication = (
    blockDistance: number,
    isComplex: boolean,
  ): BlockRangeIndication => {
    let indication: "dark green" | "light green" | "light red" | "dark red";
    let color: string;
    const limits = isComplex ? [32, 64, 96] : [64, 128, 192];

    if (blockDistance <= limits[0]) {
      indication = "dark green";
      color = "#10b981";
    } else if (blockDistance <= limits[1]) {
      indication = "light green";
      color = "#34d399";
    } else if (blockDistance <= limits[2]) {
      indication = "light red";
      color = "#f87171";
    } else {
      indication = "dark red";
      color = "#dc2626";
    }

    return { blockDistance, indication, color };
  };

  // Encode match function from original HTML/JS code
  const encodeMatch = (
    matches: string[],
    tokenSizeParam: number,
    actualHashParam: string,
    fetchedHashParam: string,
  ): string => {
    if (matches.length === 0) return "";

    const firstMatch = matches[0];
    const firstMatchPos = removePrefix(actualHashParam).indexOf(firstMatch);

    const secondMatch = matches.length > 1 ? matches[1] : firstMatch;
    const secondMatchPos = removePrefix(fetchedHashParam).indexOf(secondMatch);

    const hitHex1 = {
      startByte: firstMatchPos,
      endByte: firstMatchPos + tokenSizeParam - 1,
      leftSkip: firstMatchPos > 0,
      rightSkip: firstMatchPos + tokenSizeParam < 64,
    };

    const hitHex2 = {
      startByte: secondMatchPos,
      endByte: secondMatchPos + tokenSizeParam - 1,
      leftSkip: secondMatchPos > 0,
      rightSkip: secondMatchPos + tokenSizeParam < 64,
    };

    return npInfura.eth.abi.encodeParameters(
      ["uint8", "uint8", "bool", "bool", "uint8", "uint8", "bool", "bool"],
      [
        hitHex1.startByte,
        hitHex1.endByte,
        hitHex1.leftSkip,
        hitHex1.rightSkip,
        hitHex2.startByte,
        hitHex2.endByte,
        hitHex2.leftSkip,
        hitHex2.rightSkip,
      ],
    );
  };

  // Store match in Firebase from original HTML/JS code
  const storeMatchInFirebase = async (matchData: MatchData) => {
    try {
      const account =
        connectedAccount || localStorage.getItem("currentAccount");
      if (!account) return;

      const matchRef = ref(database, `matches/${account}/${guessId}`);
      await set(matchRef, {
        ...matchData,
        timestamp: Date.now(),
      });
      console.log("Match data stored in Firebase");
    } catch (error) {
      console.error("Firebase storage error:", error);
    }
  };

  const handleFetchAndVerify = async () => {
    if (!web3Instance) {
      showAlert("error", "Initialization Error", "Web3 not initialized.");
      return;
    }

    if (!targetBlockCount) {
      showAlert(
        "warning",
        "Missing Information",
        "No generated target block available. Please submit a guess first.",
      );
      return;
    }

    setIsFetching(true);
    setFoundTokens([]);
    setFetchedTokens([]);

    try {
      const currentBlockNumber = await web3Instance.eth.getBlockNumber();
      const blockDistance = Number(currentBlockNumber) - targetBlockCount;

      if (blockDistance < 0) {
        showAlert(
          "warning",
          "Block Not Mined",
          "The target block hasn't been mined yet. Please wait for it to be confirmed.",
        );
        setIsFetching(false);
        return;
      }

      let minedBlockHash = "";
      let finalTargetBlockNumber = targetBlockCount;

      if (!complex) {
        if (blockDistance > 255) {
          showAlert(
            "error",
            "Block Distance Exceeded",
            `Block distance is ${blockDistance} blocks. It must be within 255 blocks for standard mode.`,
          );
          setIsFetching(false);
          return;
        }

        const block = await web3Instance.eth.getBlock(targetBlockCount);
        if (block && block.hash) {
          minedBlockHash = block.hash as string;
        } else {
          showAlert(
            "error",
            "Fetch Error",
            "Unable to retrieve block hash. Please try again.",
          );
          setIsFetching(false);
          return;
        }
      } else {
        if (blockDistance > 128) {
          showAlert(
            "error",
            "Block Distance Exceeded",
            `Block distance is ${blockDistance} blocks. It must be within 128 blocks for complex mode.`,
          );
          setIsFetching(false);
          return;
        }

        const targetBlock = await web3Instance.eth.getBlock(targetBlockCount);
        if (!targetBlock || !targetBlock.hash) {
          showAlert(
            "error",
            "Fetch Error",
            "Unable to retrieve target block hash. Please try again.",
          );
          setIsFetching(false);
          return;
        }

        const randomBlockData = await getRandomBlockHash(
          targetBlock.hash as string,
          targetBlockCount,
        );

        if (!randomBlockData) {
          showAlert(
            "error",
            "Fetch Error",
            "Unable to retrieve random block hash. Please try again.",
          );
          setIsFetching(false);
          return;
        }

        minedBlockHash = randomBlockData.hash;
        finalTargetBlockNumber = randomBlockData.randomBlockNumber;

        setComplexCalculation({
          targetBlockNumber: targetBlockCount,
          targetBlockHash: targetBlock.hash as string,
          byteHex: randomBlockData.byteHex,
          adjustedRanBlockPos: randomBlockData.adjustedRanBlockPos,
          randomBlockNumber: randomBlockData.randomBlockNumber,
          randomBlockHash: randomBlockData.hash,
        });
        setShowComplexCalculation(true);
      }

      setBlockRangeIndication(
        calculateBlockRangeIndication(blockDistance, complex),
      );
      setTargetBlockHash(minedBlockHash);

      // Generate fetched tokens
      const fetchedTokensList = tokenize(
        removePrefix(minedBlockHash),
        tokenSize,
      );
      setFetchedTokens(fetchedTokensList);

      // Find matching tokens
      const matchedTokens = findMatchingTokens(
        actualHash,
        minedBlockHash,
        tokenSize,
      );
      setFoundTokens(matchedTokens);

      if (matchedTokens.length > 0) {
        // Encode match data using the original logic
        const encodedMatch = encodeMatch(
          matchedTokens,
          tokenSize,
          actualHash,
          minedBlockHash,
        );

        // Prepare match data for Firebase and localStorage
        const matchData: MatchData = {
          guessId: guessId,
          targetBlockNumber: finalTargetBlockNumber,
          actualHash: actualHash,
          fetchedHash: minedBlockHash,
          matchedTokens: matchedTokens,
          blockDistance: blockDistance,
          complex: complex,
          encodedMatch: encodedMatch,
          tokenSize: tokenSize,
          secretKey: secretKey,
          paymentPaidBet: storedGuessData?.paymentPaidBet || "0",
        };

        // Store in Firebase
        await storeMatchInFirebase(matchData);

        // Store in localStorage
        localStorage.setItem("matchData", JSON.stringify(matchData));

        showAlert(
          "success",
          `${matchedTokens.length} Match(es) Found!`,
          `Matching combinations found: (${matchedTokens.join(", ")}). You will be redirected to the On-Chain page.`,
          () => {
            navigate(`/verify-onchain/${guessId}`, {
              state: {
                actualHash: removePrefix(actualHash),
                fetchedHash: removePrefix(minedBlockHash),
                tokenSize,
                targetBlockNumber: finalTargetBlockNumber,
                storedGuessData: storedGuessData,
                blockDistance,
                complex,
                matches: matchedTokens,
                encodedMatch: encodedMatch,
              },
            });
          },
        );
      } else {
        showAlert(
          "info",
          "No Matches Found",
          "No matching patterns were found between your guess and the fetched hash.",
        );
      }
    } catch (error) {
      console.error("Error fetching target block hash:", error);
      showAlert(
        "error",
        "Fetch Error",
        "An error occurred while fetching the target block hash.",
      );
    } finally {
      setIsFetching(false);
    }
  };

  const handleBack = () => navigate("/dashboard");

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

  const getTokenClassName = (token: string): string => {
    if (foundTokens.includes(token)) {
      return "bg-green-500/30 border-green-400 text-green-300";
    }
    return "bg-black/30 border-gray-600 text-gray-300";
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="min-h-screen bg-slate-950 p-4 font-mono"
    >
      <div className="gc-geometric-bg" aria-hidden="true"></div>
      <div className="gc-dots-pattern" aria-hidden="true"></div>
      <div className="gc-floating-elements" aria-hidden="true">
        <div className="gc-float-circle"></div>
        <div className="gc-float-square"></div>
        <div className="gc-float-triangle"></div>
      </div>

      <AnimatePresence>
        {alertMessage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={handleCloseAlert}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 50 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 50 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className={`relative bg-slate-800/80 backdrop-blur-xl rounded-2xl p-8 pt-12 max-w-md w-full border ${getAlertStyles(alertMessage.type).borderClass} shadow-2xl text-center`}
              onClick={(e) => e.stopPropagation()}
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1, rotate: 10 }}
                transition={{
                  delay: 0.1,
                  type: "spring",
                  stiffness: 200,
                  damping: 15,
                }}
                className={`absolute -top-10 left-1/2 -translate-x-1/2 w-20 h-20 rounded-full flex items-center justify-center border-4 ${getAlertStyles(alertMessage.type).borderClass} ${getAlertStyles(alertMessage.type).iconBgClass}`}
              >
                {React.createElement(
                  getAlertStyles(alertMessage.type).IconComponent,
                  {
                    size: 40,
                    className: `${getAlertStyles(alertMessage.type).titleColorClass}`,
                  },
                )}
              </motion.div>

              <h3
                className={`text-2xl font-bold ${getAlertStyles(alertMessage.type).titleColorClass} mb-3`}
              >
                {alertMessage.title}
              </h3>
              <p className="text-gray-300 mb-8 whitespace-pre-wrap">
                {alertMessage.message}
              </p>
              <motion.button
                whileHover={{ scale: 1.05, y: -2 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleCloseAlert}
                className={`px-8 py-3 rounded-lg font-semibold ${getAlertStyles(alertMessage.type).buttonClass} text-white transition-all w-full shadow-lg hover:shadow-xl`}
              >
                OK
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-7xl mx-auto mb-6 relative z-10">
        <button
          onClick={handleBack}
          className="mb-4 px-4 py-2 bg-white/10 hover:bg-white/20 backdrop-blur-sm rounded-lg text-white flex items-center gap-2 transition-all"
        >
          <ArrowLeft size={20} />
          Back to Dashboard
        </button>
        <h1 className="text-3xl font-bold text-white mb-2">
          Off-Chain Hash Verification
        </h1>
        <p className="text-gray-300">
          Verify your guess against the blockchain hash
        </p>
        {currentBlockNumber > 0 && (
          <p className="text-sm text-gray-400 mt-1">
            Current Block: {currentBlockNumber.toLocaleString()}
          </p>
        )}
      </div>

      <div className="max-w-7xl mx-auto relative z-10">
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/20 shadow-xl mb-6"
        >
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <Info size={20} className="text-blue-400" />
            Guess Information
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <p className="text-gray-400 text-sm mb-1">Guess ID</p>
              <p className="text-xl font-bold text-white">#{guessId}</p>
            </div>
            <div className="text-center">
              <p className="text-gray-400 text-sm mb-1">Target Block</p>
              <p className="text-xl font-bold text-white">
                {targetBlockCount ? targetBlockCount.toLocaleString() : "..."}
              </p>
            </div>
            <div className="text-center">
              <p className="text-gray-400 text-sm mb-1">Token Size</p>
              <p className="text-xl font-bold text-white">{tokenSize}</p>
            </div>
            <div className="text-center">
              <p className="text-gray-400 text-sm mb-1">Type</p>
              <div className="flex justify-center gap-2">
                <span
                  className={`px-2 py-1 rounded-full text-xs font-medium ${paidGuess ? "bg-green-500/20 text-green-300" : "bg-blue-500/20 text-blue-300"}`}
                >
                  {paidGuess ? "💰 Paid" : "🆓 Free"}
                </span>
                <span
                  className={`px-2 py-1 rounded-full text-xs font-medium ${complex ? "bg-red-500/20 text-red-300" : "bg-indigo-500/20 text-indigo-300"}`}
                >
                  {complex ? "🔥 Complex" : "⚡ Standard"}
                </span>
              </div>
            </div>
          </div>
        </motion.section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/20 shadow-xl"
            >
              <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                <Zap size={20} className="text-yellow-400" />
                Verification Action
              </h2>
              <div className="flex justify-center">
                <button
                  onClick={handleFetchAndVerify}
                  disabled={isFetching || !web3Instance}
                  className="w-full md:w-2/3 flex items-center justify-center gap-2 px-6 py-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg text-lg"
                >
                  {isFetching ? (
                    <>
                      <Zap className="animate-spin" size={24} />
                      Fetching & Comparing...
                    </>
                  ) : (
                    <>
                      <Search size={24} />
                      Fetch & Verify Hash
                    </>
                  )}
                </button>
              </div>
            </motion.section>

            {(actualTokens.length > 0 || fetchedTokens.length > 0) && (
              <motion.section
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/20 shadow-xl"
              >
                <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                  <Hash size={20} className="text-purple-400" />
                  Token Comparison
                </h2>

                {actualTokens.length > 0 && (
                  <div className="mb-4">
                    <p className="text-gray-400 text-sm mb-2">
                      Your Guess Tokens
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {actualTokens.map((token, index) => (
                        <span
                          key={`actual-${index}`}
                          className={`px-3 py-1 rounded-md font-mono text-xs border ${getTokenClassName(token)}`}
                        >
                          {token}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {fetchedTokens.length > 0 && (
                  <div>
                    <p className="text-gray-400 text-sm mb-2">
                      Fetched Block Tokens
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {fetchedTokens.map((token, index) => (
                        <span
                          key={`fetched-${index}`}
                          className={`px-3 py-1 rounded-md font-mono text-xs border ${getTokenClassName(token)}`}
                        >
                          {token}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </motion.section>
            )}

            {targetBlockHash && (
              <motion.section
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/20 shadow-xl"
              >
                <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                  <Search size={20} className="text-blue-400" />
                  Fetched Block Hash
                </h2>
                <div className="bg-black/30 p-4 rounded-lg font-mono text-sm text-gray-200 overflow-x-auto border border-blue-500/30">
                  {targetBlockHash}
                </div>

                {blockRangeIndication && (
                  <div
                    className="mt-4 p-4 rounded-lg border"
                    style={{
                      backgroundColor: `${blockRangeIndication.color}10`,
                      borderColor: `${blockRangeIndication.color}40`,
                    }}
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-gray-400 text-sm">Block Distance</p>
                        <p className="text-xl font-bold text-white">
                          {blockRangeIndication.blockDistance} blocks
                        </p>
                      </div>
                      <span
                        className="px-4 py-2 rounded-full text-sm font-medium"
                        style={{
                          backgroundColor: `${blockRangeIndication.color}30`,
                          color: blockRangeIndication.color,
                          border: `1px solid ${blockRangeIndication.color}50`,
                        }}
                      >
                        {blockRangeIndication.indication}
                      </span>
                    </div>
                  </div>
                )}
              </motion.section>
            )}

            {showComplexCalculation && complexCalculation && (
              <motion.section
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/20 shadow-xl"
              >
                <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                  <Cpu size={20} className="text-orange-400" />
                  Complex Mode Details
                </h2>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-gray-400 text-sm">Target Block</p>
                    <p className="text-white font-mono font-bold">
                      {complexCalculation.targetBlockNumber}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-400 text-sm">Random Block</p>
                    <p className="text-white font-mono font-bold">
                      {complexCalculation.randomBlockNumber}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-400 text-sm">Byte Hex</p>
                    <p className="text-white font-mono font-bold">
                      {complexCalculation.byteHex}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-400 text-sm">Adjusted Position</p>
                    <p className="text-white font-mono font-bold">
                      {complexCalculation.adjustedRanBlockPos}
                    </p>
                  </div>
                </div>
              </motion.section>
            )}

            {foundTokens.length > 0 && (
              <motion.section
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/20 shadow-xl"
              >
                <h2 className="text-xl font-semibold text-white mb-4">
                  {`Match Results: ${foundTokens.length} Found`}
                </h2>
                <div className="space-y-3 max-h-60 overflow-y-auto pr-2">
                  {foundTokens.map((token, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-3 bg-black/30 p-3 rounded-lg border border-green-500/30"
                    >
                      <Hammer
                        size={20}
                        className="text-green-400 flex-shrink-0"
                      />
                      <p className="text-green-300 font-mono text-lg break-all">
                        {token}
                      </p>
                    </div>
                  ))}
                </div>
              </motion.section>
            )}
          </div>

          <div className="space-y-6">
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/20 shadow-xl"
            >
              <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                <Hash size={20} className="text-purple-400" />
                Your Guess Hash Details
              </h2>
              <div className="space-y-4">
                <div>
                  <p className="text-gray-400 text-xs mb-2">
                    Actual Hash (Your Guess)
                  </p>
                  <div className="bg-black/30 p-3 rounded-lg font-mono text-xs text-gray-200 overflow-x-auto break-all">
                    {actualHash || "N/A"}
                  </div>
                </div>
                <div>
                  <p className="text-gray-400 text-xs mb-2">Secret Key</p>
                  <div className="bg-black/30 p-3 rounded-lg font-mono text-xs text-gray-200 overflow-x-auto break-all">
                    {secretKey || "N/A"}
                  </div>
                </div>
                <div>
                  <p className="text-gray-400 text-xs mb-2">Dummy Hash</p>
                  <div className="bg-black/30 p-3 rounded-lg font-mono text-xs text-gray-200 overflow-x-auto break-all">
                    {dummyHash || "N/A"}
                  </div>
                </div>
              </div>
            </motion.section>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default VerifyOffChain;
function setIsLoading(arg0: boolean) {
  throw new Error("Function not implemented.");
}

