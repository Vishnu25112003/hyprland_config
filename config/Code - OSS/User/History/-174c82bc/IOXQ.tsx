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

// WALLET-SPECIFIC HELPER FUNCTIONS
const getWalletStorageKey = (walletAddress: string, key: string): string => {
  return `${walletAddress.toLowerCase()}_${key}`;
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

// MIGRATION FUNCTION: Migrate old data to wallet-specific format
const migrateOldDataToWalletSpecific = (walletAddress: string): void => {
  try {
    const oldAllGuesses = localStorage.getItem("allGuessSubmissions");
    const walletKey = getWalletStorageKey(walletAddress, "allGuessSubmissions");
    const alreadyMigrated = localStorage.getItem(walletKey);
    
    if (oldAllGuesses && !alreadyMigrated) {
      console.log("🔄 Migrating old guess data to wallet-specific storage...");
      const oldGuesses = JSON.parse(oldAllGuesses);
      setWalletLocalStorage(walletAddress, "allGuessSubmissions", oldGuesses);
      console.log("✅ Migration complete!");
    }
  } catch (error) {
    console.error("Migration error:", error);
  }
};

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
  const [isLoading, setIsLoading] = useState(true);
  const [currentBlockNumber, setCurrentBlockNumber] = useState(0);

  // MIGRATION: Run once when component mounts
  useEffect(() => {
    if (connectedAccount && connectedAccount !== "0x0") {
      migrateOldDataToWalletSpecific(connectedAccount);
    }
  }, [connectedAccount]);

  // Initialize Web3
  useEffect(() => {
    const initWeb3 = async () => {
      try {
        const infuraProjectId = "YOUR_INFURA_PROJECT_ID"; // Replace with your Infura ID
        const infuraUrl = `https://polygon-amoy.infura.io/v3/${infuraProjectId}`;
        const web3 = new Web3(new Web3.providers.HttpProvider(infuraUrl));
        setWeb3Instance(web3);

        const blockNumber = await web3.eth.getBlockNumber();
        setCurrentBlockNumber(Number(blockNumber));
      } catch (error) {
        console.error("Error initializing Web3:", error);
      }
    };

    initWeb3();
  }, []);

  // UPDATED: Load guess data from wallet-specific localStorage
  useEffect(() => {
    const loadGuessData = async () => {
      if (!connectedAccount) {
        console.error("No wallet connected");
        setAlertMessage({
          type: "error",
          title: "Wallet Not Connected",
          message: "Please connect your wallet to verify your guess.",
          onConfirm: () => navigate("/wallet"),
        });
        setIsLoading(false);
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
          setPaidGuess(currentGuess.paymentPaidBet !== "0");
          
          const targetBlock = currentGuess.contractBlockNumber || currentGuess.blockIncrementCount;
          setTargetBlockCount(parseInt(targetBlock));
        } else {
          console.warn(`No guess data found for guessId: ${guessId}`);
          setAlertMessage({
            type: "warning",
            title: "No Guess Data",
            message: `No guess data found for Guess ID ${guessId} in your wallet.`,
            onConfirm: () => navigate("/dashboard"),
          });
        }

        setIsLoading(false);
      } catch (error) {
        console.error("Error loading guess data:", error);
        setIsLoading(false);
      }
    };

    loadGuessData();
  }, [guessId, connectedAccount, navigate]);

  // Tokenize function
  const tokenize = (hash: string, size: number): string[] => {
    const cleanHash = hash.replace(/^0x/, "");
    const tokens: string[] = [];
    for (let i = 0; i < cleanHash.length; i += size) {
      tokens.push(cleanHash.substring(i, i + size));
    }
    return tokens;
  };

  // Calculate block range indication
  const calculateBlockRangeIndication = (
    distance: number
  ): BlockRangeIndication => {
    let indication: "dark green" | "light green" | "light red" | "dark red";
    let color: string;

    if (distance <= 2) {
      indication = "dark green";
      color = "#10b981";
    } else if (distance <= 10) {
      indication = "light green";
      color = "#34d399";
    } else if (distance <= 256) {
      indication = "light red";
      color = "#fb923c";
    } else {
      indication = "dark red";
      color = "#ef4444";
    }

    return { blockDistance: distance, indication, color };
  };

  // Fetch target block hash
  const fetchTargetBlockHash = async () => {
    if (!web3Instance) {
      setAlertMessage({
        type: "error",
        title: "Web3 Not Initialized",
        message: "Please wait for Web3 to initialize.",
      });
      return;
    }

    if (!targetBlockCount) {
      setAlertMessage({
        type: "error",
        title: "Invalid Block Number",
        message: "Target block number is not set.",
      });
      return;
    }

    setIsFetching(true);
    setFoundTokens([]);
    setBlockRangeIndication(null);
    setComplexCalculation(null);
    setShowComplexCalculation(false);

    try {
      const currentBlock = await web3Instance.eth.getBlockNumber();
      const distanceToTarget = Math.abs(
        Number(currentBlock) - targetBlockCount
      );

      setCurrentBlockNumber(Number(currentBlock));

      const rangeIndication = calculateBlockRangeIndication(distanceToTarget);
      setBlockRangeIndication(rangeIndication);

      let fetchedHash: string;
      let targetBlockNumber = targetBlockCount;

      if (complex && distanceToTarget > 256) {
        setShowComplexCalculation(true);

        const targetBlock = await web3Instance.eth.getBlock(targetBlockCount);
        if (!targetBlock || !targetBlock.hash) {
          throw new Error("Target block not found");
        }

        const targetHash = targetBlock.hash.toString();
        const byteHex = targetHash.slice(2, 4);
        const byteValue = parseInt(byteHex, 16);
        const adjustedPosition = byteValue % 256;
        const randomBlockNumber = targetBlockCount - adjustedPosition;

        const randomBlock = await web3Instance.eth.getBlock(randomBlockNumber);
        if (!randomBlock || !randomBlock.hash) {
          throw new Error("Random block not found");
        }

        fetchedHash = randomBlock.hash.toString();

        setComplexCalculation({
          targetBlockNumber: targetBlockCount,
          targetBlockHash: targetHash,
          byteHex,
          adjustedRanBlockPos: adjustedPosition,
          randomBlockNumber,
          randomBlockHash: fetchedHash,
        });
      } else {
        const block = await web3Instance.eth.getBlock(targetBlockCount);
        if (!block || !block.hash) {
          throw new Error("Block not found");
        }
        fetchedHash = block.hash.toString();
      }

      setTargetBlockHash(fetchedHash);

      const guessTokens = tokenize(actualHash, tokenSize);
      const fetchedTokens = tokenize(fetchedHash, tokenSize);

      setFoundTokens(fetchedTokens);

      const matches: string[] = [];
      guessTokens.forEach((token, index) => {
        if (fetchedTokens.includes(token)) {
          matches.push(`${index}:${token}`);
        }
      });

      if (matches.length > 0) {
        const encodedMatchData = matches.join(",");

        // UPDATED: Save to wallet-specific localStorage
        if (connectedAccount) {
          const matchDataToSave: MatchData = {
            guessId,
            targetBlockNumber,
            actualHash,
            fetchedHash,
            matchedTokens: matches,
            blockDistance: distanceToTarget,
            complex,
            encodedMatch: encodedMatchData,
            tokenSize,
            secretKey,
            paymentPaidBet: storedGuessData?.paymentPaidBet || "0",
          };

          setWalletLocalStorage(connectedAccount, `matchData_${guessId}`, matchDataToSave);
        }

        setAlertMessage({
          type: "success",
          title: "Match Found!",
          message: `Found ${matches.length} matching token(s). Click "Proceed to On-Chain Verification" to continue.`,
        });
      } else {
        setAlertMessage({
          type: "warning",
          title: "No Matches",
          message:
            "No matching tokens found between your guess and the blockchain hash.",
        });
      }
    } catch (error: any) {
      console.error("Error fetching block hash:", error);
      setAlertMessage({
        type: "error",
        title: "Fetch Error",
        message: error.message || "Failed to fetch block hash.",
      });
    } finally {
      setIsFetching(false);
    }
  };

  const handleProceedToOnChain = () => {
    if (!connectedAccount) {
      setAlertMessage({
        type: "error",
        title: "Wallet Not Connected",
        message: "Please connect your wallet first.",
      });
      return;
    }

    // UPDATED: Get matchData from wallet-specific localStorage
    const matchData = getWalletLocalStorage(connectedAccount, `matchData_${guessId}`);

    if (!matchData || !matchData.matchedTokens || matchData.matchedTokens.length === 0) {
      setAlertMessage({
        type: "error",
        title: "No Match Data",
        message: "Please verify off-chain first to find matching tokens.",
      });
      return;
    }

    navigate(`/verify-onchain/${guessId}`, {
      state: {
        actualHash: matchData.actualHash,
        fetchedHash: matchData.fetchedHash,
        tokenSize: matchData.tokenSize,
        targetBlockNumber: matchData.targetBlockNumber,
        storedGuessData,
        blockDistance: matchData.blockDistance,
        complex: matchData.complex,
        matches: matchData.matchedTokens,
        encodedMatch: matchData.encodedMatch,
      },
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-black flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-white text-xl"
        >
          Loading...
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-black py-8 px-4">
      {/* Alert Modal */}
      <AnimatePresence>
        {alertMessage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-gray-800 rounded-2xl p-6 max-w-md w-full border-2 border-purple-500"
            >
              <div className="flex items-center gap-3 mb-4">
                {alertMessage.type === "success" && (
                  <CheckCircle className="text-green-400" size={32} />
                )}
                {alertMessage.type === "error" && (
                  <XCircle className="text-red-400" size={32} />
                )}
                {alertMessage.type === "warning" && (
                  <AlertTriangle className="text-yellow-400" size={32} />
                )}
                {alertMessage.type === "info" && (
                  <Info className="text-blue-400" size={32} />
                )}
                <h3 className="text-xl font-bold text-white">
                  {alertMessage.title}
                </h3>
              </div>
              <p className="text-gray-300 mb-6 whitespace-pre-line">
                {alertMessage.message}
              </p>
              <button
                onClick={() => {
                  if (alertMessage.onConfirm) {
                    alertMessage.onConfirm();
                  }
                  setAlertMessage(null);
                }}
                className="w-full py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold transition-colors"
              >
                OK
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <button
            onClick={() => navigate("/dashboard")}
            className="flex items-center gap-2 text-purple-400 hover:text-purple-300 mb-4 transition-colors"
          >
            <ArrowLeft size={20} />
            <span>Back to Dashboard</span>
          </button>
          <h1 className="text-4xl font-bold text-white mb-2">
            Off-Chain Verification
          </h1>
          <p className="text-gray-400">
            Verify your guess against the blockchain hash
          </p>
          {currentBlockNumber > 0 && (
            <p className="text-sm text-purple-400 mt-2">
              Current Block: {currentBlockNumber.toLocaleString()}
            </p>
          )}
        </motion.div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Panel: Info */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-gray-800/50 backdrop-blur-sm rounded-2xl p-6 border border-purple-500/30"
          >
            <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
              <Hash size={24} className="text-purple-400" />
              Guess Information
            </h2>

            <div className="space-y-4">
              <div>
                <label className="text-sm text-gray-400">Guess ID</label>
                <p className="text-white font-mono text-lg">#{guessId}</p>
              </div>

              <div>
                <label className="text-sm text-gray-400">Target Block</label>
                <p className="text-white font-mono text-lg">
                  {targetBlockCount ? targetBlockCount.toLocaleString() : "..."}
                </p>
              </div>

              <div>
                <label className="text-sm text-gray-400">Token Size</label>
                <p className="text-white font-mono text-lg">{tokenSize}</p>
              </div>

              <div>
                <label className="text-sm text-gray-400">Type</label>
                <p className="text-white font-mono text-lg">
                  {complex ? "Complex" : "Simple"} |{" "}
                  {paidGuess ? "Paid" : "Free"}
                </p>
              </div>

              {blockRangeIndication && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="p-4 rounded-lg"
                  style={{
                    backgroundColor: `${blockRangeIndication.color}20`,
                    borderColor: blockRangeIndication.color,
                    borderWidth: "2px",
                  }}
                >
                  <label className="text-sm text-gray-400">
                    Block Distance
                  </label>
                  <p
                    className="font-bold text-lg"
                    style={{ color: blockRangeIndication.color }}
                  >
                    {blockRangeIndication.blockDistance} blocks
                  </p>
                  <p className="text-sm text-gray-300 mt-1">
                    {blockRangeIndication.indication}
                  </p>
                </motion.div>
              )}

              {showComplexCalculation && complexCalculation && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="bg-purple-900/30 p-4 rounded-lg border border-purple-500/50"
                >
                  <h3 className="text-lg font-bold text-purple-300 mb-3 flex items-center gap-2">
                    <Cpu size={20} />
                    Complex Calculation
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-gray-400">Target Block:</span>
                      <span className="text-white font-mono ml-2">
                        {complexCalculation.targetBlockNumber}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-400">Random Block:</span>
                      <span className="text-white font-mono ml-2">
                        {complexCalculation.randomBlockNumber}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-400">Byte Hex:</span>
                      <span className="text-white font-mono ml-2">
                        {complexCalculation.byteHex}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-400">Adjusted Position:</span>
                      <span className="text-white font-mono ml-2">
                        {complexCalculation.adjustedRanBlockPos}
                      </span>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>

            <button
              onClick={fetchTargetBlockHash}
              disabled={isFetching || !targetBlockCount}
              className="w-full mt-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 disabled:from-gray-600 disabled:to-gray-700 text-white rounded-lg font-semibold transition-all flex items-center justify-center gap-2"
            >
              {isFetching ? (
                <>
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{
                      duration: 1,
                      repeat: Infinity,
                      ease: "linear",
                    }}
                  >
                    <Search size={20} />
                  </motion.div>
                  Verifying...
                </>
              ) : (
                <>
                  <Zap size={20} />
                  Verify Off-Chain
                </>
              )}
            </button>
          </motion.div>

          {/* Right Panel: Tokens */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-gray-800/50 backdrop-blur-sm rounded-2xl p-6 border border-purple-500/30"
          >
            <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
              <Hammer size={24} className="text-purple-400" />
              Token Comparison
            </h2>

            <div className="space-y-6">
              {/* Your Guess Tokens */}
              <div>
                <label className="text-sm text-gray-400 mb-2 block">
                  Your Guess Tokens
                </label>
                <div className="flex flex-wrap gap-2">
                  {tokenize(actualHash, tokenSize).map((token, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: idx * 0.05 }}
                      className="px-3 py-2 bg-purple-900/50 border border-purple-500/50 rounded-lg font-mono text-sm text-white"
                    >
                      {token}
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* Fetched Block Tokens */}
              {foundTokens.length > 0 && (
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">
                    Fetched Block Tokens
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {foundTokens.map((token, idx) => {
                      const isMatch = tokenize(actualHash, tokenSize).includes(
                        token
                      );
                      return (
                        <motion.div
                          key={idx}
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: idx * 0.05 }}
                          className={`px-3 py-2 rounded-lg font-mono text-sm ${
                            isMatch
                              ? "bg-green-900/50 border-2 border-green-500 text-green-300 font-bold"
                              : "bg-gray-700/50 border border-gray-600 text-gray-300"
                          }`}
                        >
                          {token}
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {foundTokens.length > 0 && (
              <button
                onClick={handleProceedToOnChain}
                className="w-full mt-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white rounded-lg font-semibold transition-all flex items-center justify-center gap-2"
              >
                <CheckCircle size={20} />
                Proceed to On-Chain Verification
              </button>
            )}
          </motion.div>
        </div>

        {/* Bottom Info Cards */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-4 border border-purple-500/30"
          >
            <h3 className="text-sm font-semibold text-gray-400 mb-2">
              Actual Hash (Your Guess)
            </h3>
            <p className="text-white font-mono text-xs break-all">
              {actualHash}
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-4 border border-purple-500/30"
          >
            <h3 className="text-sm font-semibold text-gray-400 mb-2">
              Secret Key
            </h3>
            <p className="text-white font-mono text-xs break-all">
              {secretKey}
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-4 border border-purple-500/30"
          >
            <h3 className="text-sm font-semibold text-gray-400 mb-2">
              Dummy Hash
            </h3>
            <p className="text-white font-mono text-xs break-all">
              {dummyHash}
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default VerifyOffChain;
