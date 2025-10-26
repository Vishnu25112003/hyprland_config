// src/components/newguess/GuessPage.tsx

import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Web3 from "web3";
import { ref, set } from "firebase/database";
import GuessUI, { ConfirmationModal } from "./UI";
import { useAuth } from "../../context/AuthContext";
import { database } from "../../config/firebase";
import {
  TOKEN_CONTRACT_ADDRESS,
  TOKEN_CONTRACT_ABI,
  LOGIC_CONTRACT_ABI,
} from "../../config/contracts";
import { POLYGON_AMOY_TESTNET } from "../../config/networks";

// Import only hashing functions from HashUtils
import {
  genHashData,
  removePrefix,
  tokenize,
  getUnrevealedHash,
  validateHashFormat,
  ZERO_HASH,
} from "./HashUtils";

// FIXED: Helper function to convert BigInt values to strings for JSON serialization
const convertBigIntToString = (obj: any): any => {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === "bigint") {
    return obj.toString();
  }

  if (Array.isArray(obj)) {
    return obj.map(convertBigIntToString);
  }

  if (typeof obj === "object") {
    const converted: any = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        converted[key] = convertBigIntToString(obj[key]);
      }
    }
    return converted;
  }

  return obj;
};

// Submission data structure
interface GuessSubmissionData {
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
}

// Complete exportable data structure
interface ExportableGuessData extends GuessSubmissionData {
  guessId: number;
  tokens: string[];
  timestamp: number;
  txHash?: string;
  gasUsed?: string;
  formattedPayment: string;
  contractBlockNumber?: string;
}

// WALLET-SPECIFIC HELPER FUNCTIONS
const getWalletStorageKey = (walletAddress: string, key: string): string => {
  return `${walletAddress.toLowerCase()}_${key}`;
};

const setWalletLocalStorage = (walletAddress: string, key: string, value: any): void => {
  const storageKey = getWalletStorageKey(walletAddress, key);
  localStorage.setItem(storageKey, JSON.stringify(value));
};

const getWalletLocalStorage = (walletAddress: string, key: string): any => {
  const storageKey = getWalletStorageKey(walletAddress, key);
  const data = localStorage.getItem(storageKey);
  return data ? JSON.parse(data) : null;
};

// MIGRATION FUNCTION: Migrate old localStorage data to wallet-specific format (NO DATA LOSS)
const migrateOldDataToWalletSpecific = (walletAddress: string): void => {
  try {
    // Check if old format data exists
    const oldAllGuesses = localStorage.getItem("allGuessSubmissions");
    const oldLastGuess = localStorage.getItem("lastGuessSubmission");
    
    // Check if already migrated for this wallet
    const walletKey = getWalletStorageKey(walletAddress, "allGuessSubmissions");
    const alreadyMigrated = localStorage.getItem(walletKey);
    
    if (oldAllGuesses && !alreadyMigrated) {
      console.log("🔄 Migrating old guess data to wallet-specific storage...");
      
      // Migrate allGuessSubmissions
      const oldGuesses = JSON.parse(oldAllGuesses);
      setWalletLocalStorage(walletAddress, "allGuessSubmissions", oldGuesses);
      
      // Migrate lastGuessSubmission
      if (oldLastGuess) {
        const lastGuess = JSON.parse(oldLastGuess);
        setWalletLocalStorage(walletAddress, "lastGuessSubmission", lastGuess);
      }
      
      console.log("✅ Migration complete! Data preserved for wallet:", walletAddress);
      
      // DO NOT delete old data yet - keep for safety
      // Users can manually clear it later after verification
    }
  } catch (error) {
    console.error("Migration error:", error);
  }
};

const GuessPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const guessId = parseInt(id || "1", 10);
  const { connectedAccount } = useAuth();

  // State management
  const [paidGuess, setPaidGuess] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [complex, setComplex] = useState(false);
  const [blockIncrement, setBlockIncrement] = useState(10);
  const [actualHash, setActualHash] = useState("");
  const [actualHashInput, setActualHashInput] = useState("");
  const [secretHash, setSecretHash] = useState("");
  const [secretHashInput, setSecretHashInput] = useState("");
  const [dummyHash, setDummyHash] = useState(ZERO_HASH);
  const [tokenSize, setTokenSize] = useState(3);
  const [tokens, setTokens] = useState<string[]>([]);

  // Loading states
  const [isGeneratingActual, setIsGeneratingActual] = useState(false);
  const [isGeneratingSecret, setIsGeneratingSecret] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form readonly state
  const [isFormReadonly, setIsFormReadonly] = useState(true);

  // Modal states
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    type: "warning" | "error" | "info" | "success";
    confirmText?: string;
    cancelText?: string;
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
    type: "info",
  });

  // MIGRATION: Run once when component mounts with connected wallet
  useEffect(() => {
    if (connectedAccount && connectedAccount !== "0x0") {
      migrateOldDataToWalletSpecific(connectedAccount);
    }
  }, [connectedAccount]);

  // Form readonly control
  useEffect(() => {
    setIsFormReadonly(!overwrite);
  }, [overwrite]);

  // Generate tokens when actualHash or tokenSize changes
  useEffect(() => {
    const generateTokens = async () => {
      if (actualHash && actualHash !== ZERO_HASH) {
        try {
          const cleanedHash = await removePrefix(actualHash);
          if (cleanedHash.length >= tokenSize) {
            const generatedTokens: string[] = await tokenize(
              cleanedHash,
              tokenSize,
            );
            setTokens(generatedTokens);
          } else {
            setTokens([]);
          }
        } catch (error) {
          console.error("Error generating tokens:", error);
          setTokens([]);
        }
      } else {
        setTokens([]);
      }
    };

    generateTokens();
  }, [actualHash, tokenSize]);

  // Auto-generate dummy hash
  useEffect(() => {
    const generateDummyHash = async () => {
      if (
        actualHash &&
        secretHash &&
        actualHash !== ZERO_HASH &&
        secretHash !== ZERO_HASH
      ) {
        try {
          const isActualValid = await validateHashFormat(actualHash);
          const isSecretValid = await validateHashFormat(secretHash);

          if (isActualValid && isSecretValid) {
            const combined = await getUnrevealedHash(actualHash, secretHash);
            setDummyHash(combined);
          } else {
            setDummyHash(ZERO_HASH);
          }
        } catch (error) {
          console.error("Error generating dummy hash:", error);
          setDummyHash(ZERO_HASH);
        }
      } else {
        setDummyHash(ZERO_HASH);
      }
    };

    generateDummyHash();
  }, [actualHash, secretHash]);

  const handlePaidGuessChange = (value: boolean) => {
    const message = value
      ? "Do you want to proceed with Paid Guess?\n\nNote: This requires 25 tokens in your wallet and may need token approval."
      : "Do you want to proceed with Free Guess?";

    setConfirmModal({
      isOpen: true,
      title: "Confirmation",
      message,
      onConfirm: () => {
        setPaidGuess(value);
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
      },
      type: value ? "warning" : "info",
      confirmText: "Yes",
      cancelText: "No",
    });
  };

  const handleOverwriteChange = (value: boolean) => {
    if (value) {
      if (connectedAccount && connectedAccount !== "0x0") {
        setConfirmModal({
          isOpen: true,
          title: "Enable Overwrite",
          message:
            "Enabling overwrite will allow you to modify all form fields and submit new guess data. Do you want to continue?",
          onConfirm: () => {
            setOverwrite(true);
            setIsFormReadonly(false);
            setConfirmModal((prev) => ({ ...prev, isOpen: false }));
          },
          type: "warning",
          confirmText: "Yes, Enable",
          cancelText: "Cancel",
        });
      } else {
        setOverwrite(true);
        setIsFormReadonly(false);
      }
    } else {
      setOverwrite(false);
      setIsFormReadonly(true);
    }
  };

  const handleComplexChange = (value: boolean) => {
    setComplex(value);
  };

  const handleBlockIncrementChange = (value: number) => {
    if (value >= 10 && value <= 2048) {
      setBlockIncrement(value);
    }
  };

  const handleTokenSizeChange = (value: number) => {
    if (value >= 3 && value <= 64) {
      setTokenSize(value);
    }
  };

  const handleActualHashChange = (value: string) => {
    setActualHashInput(value);
  };

  const handleSecretHashChange = (value: string) => {
    setSecretHashInput(value);
  };

  const handleGenerateActualHash = async () => {
    setIsGeneratingActual(true);
    try {
      let hashInput = actualHashInput.trim();
      if (!hashInput) {
        hashInput = Date.now().toString() + Math.random().toString();
      }

      const generatedHash = await genHashData(hashInput);
      setActualHash(generatedHash);
      setActualHashInput(generatedHash);
    } catch (error) {
      console.error("Error generating actual hash:", error);
    } finally {
      setIsGeneratingActual(false);
    }
  };

  const handleGenerateSecretHash = async () => {
    setIsGeneratingSecret(true);
    try {
      let hashInput = secretHashInput.trim();
      if (!hashInput) {
        hashInput = Date.now().toString() + Math.random().toString() + "secret";
      }

      const generatedHash = await genHashData(hashInput);
      setSecretHash(generatedHash);
      setSecretHashInput(generatedHash);
    } catch (error) {
      console.error("Error generating secret hash:", error);
    } finally {
      setIsGeneratingSecret(false);
    }
  };

  const validateForm = async (): Promise<string[]> => {
    const errors: string[] = [];

    if (!guessId) errors.push("Guess ID is required.");
    if (!blockIncrement) errors.push("Block Increment Count is required.");
    if (!actualHash) errors.push("Actual Hash is required.");
    if (!secretHash) errors.push("Secret Key Hash is required.");
    if (!dummyHash) errors.push("Dummy Hash is required.");
    if (!tokenSize) errors.push("Token Size is required.");

    if (blockIncrement < 10 || blockIncrement > 2048) {
      errors.push("Please enter a valid block number between 513 and 2048");
    }

    if (tokenSize < 3 || tokenSize > 64) {
      errors.push("Please enter a valid token size between 4 and 64");
    }

    if (actualHash) {
      const isActualValid = await validateHashFormat(actualHash);
      if (!isActualValid) {
        errors.push(
          "Actual hash must be a valid 64-character hexadecimal string.",
        );
      }
    }

    if (secretHash) {
      const isSecretValid = await validateHashFormat(secretHash);
      if (!isSecretValid) {
        errors.push(
          "Secret key Hash must be a valid 64-character hexadecimal string.",
        );
      }
    }

    if (dummyHash) {
      const isDummyValid = await validateHashFormat(dummyHash);
      if (!isDummyValid) {
        errors.push(
          "Dummy hash must be a valid 64-character hexadecimal string.",
        );
      }
    }

    if (!overwrite) {
      errors.push(
        "Cannot submit the form with overwrite is false. Please enable overwrite to submit.",
      );
    }

    if (dummyHash === ZERO_HASH) {
      errors.push("Dummy hash cannot be the default zero value.");
    }

    if (actualHash === ZERO_HASH) {
      errors.push("Actual hash cannot be the default zero value.");
    }

    if (secretHash === ZERO_HASH) {
      errors.push("Secret key cannot be the default zero value.");
    }

    if (isNaN(blockIncrement)) {
      errors.push("Block Increment Count must be a number.");
    }

    if (isNaN(tokenSize)) {
      errors.push("Token Size must be a number.");
    }

    if (tokenSize === 0) {
      errors.push("Token Size cannot be zero.");
    }

    return errors;
  };

  // Initialize Web3 contract instances using contracts.ts
  const initContractInstance = async (contractType: "token" | "logic") => {
    try {
      if (!window.ethereum) {
        throw new Error("No wallet detected!");
      }

      const web3 = new Web3(window.ethereum);
      const chainId = await web3.eth.getChainId();
      const expectedChainId = parseInt(POLYGON_AMOY_TESTNET.chainId, 16);

      if (Number(chainId) !== expectedChainId) {
        throw new Error(
          "Wrong network! Please switch to Polygon Amoy Testnet.",
        );
      }

      let contractAddress: string;
      let contractABI: any;

      if (contractType === "token") {
        contractAddress = TOKEN_CONTRACT_ADDRESS;
        contractABI = TOKEN_CONTRACT_ABI;
      } else {
        const logicAddress = localStorage.getItem("logicCrtAddress");
        if (!logicAddress || logicAddress === "0x0" || logicAddress === "0x") {
          throw new Error(
            "Logic contract not found. Please complete registration first.",
          );
        }
        contractAddress = logicAddress;
        contractABI = LOGIC_CONTRACT_ABI;
      }

      const contractInstance = new web3.eth.Contract(
        contractABI,
        contractAddress,
      );

      return { contractInstance, web3 };
    } catch (error: any) {
      console.error("Error initializing contract:", error);
      throw error;
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);

    try {
      const errors = await validateForm();
      if (errors.length > 0) {
        setConfirmModal({
          isOpen: true,
          title: "Validation Errors",
          message: errors.join("\n"),
          onConfirm: () =>
            setConfirmModal((prev) => ({ ...prev, isOpen: false })),
          type: "error",
        });
        return;
      }

      const registeredWallet =
        connectedAccount || localStorage.getItem("currentAccount");

      if (!registeredWallet || registeredWallet === "0x0") {
        throw new Error(
          "No registered wallet found. Please connect your wallet first.",
        );
      }

      const logicAddress = localStorage.getItem("logicCrtAddress");
      if (!logicAddress || logicAddress === "0x0" || logicAddress === "0x") {
        throw new Error(
          "Logic contract not found. Please complete registration first.",
        );
      }

      console.log("Using registered wallet:", registeredWallet);
      console.log("Logic contract address:", logicAddress);

      const { contractInstance: logicContract, web3 } =
        await initContractInstance("logic");

      console.log("Contract initialized successfully");

      const paymentAmount = paidGuess ? "25000000000000000000" : "0";

      const dummyHashWith0x = dummyHash.startsWith("0x")
        ? dummyHash
        : "0x" + dummyHash;

      console.log("Submitting with parameters:", {
        guessId,
        blockIncrement,
        dummyHashWith0x: dummyHashWith0x.substring(0, 10) + "...",
        tokenSize,
        paymentAmount,
        overwrite,
        complex,
      });

      // Check token balance for paid guess
      if (paidGuess) {
        try {
          const { contractInstance: tokenContract } =
            await initContractInstance("token");

          const balanceRaw = await tokenContract.methods
            .balanceOf(registeredWallet)
            .call();

          const balanceStr = String(balanceRaw || "0");
          const balance = BigInt(balanceStr);
          const balanceInEther = Number(balance) / 1e18;

          console.log("Token balance:", balanceInEther);

          if (balanceInEther < 25) {
            throw new Error(
              `Insufficient token balance. You need 25 tokens but have ${balanceInEther.toFixed(2)} tokens.`,
            );
          }

          const requiredAllowance = web3.utils.toWei("25", "ether");
          const requiredStr = String(requiredAllowance || "0");
          const requiredBigInt = BigInt(requiredStr);

          const allowanceRaw = await tokenContract.methods
            .allowance(registeredWallet, logicAddress)
            .call();

          const allowanceStr = String(allowanceRaw || "0");
          const allowanceBigInt = BigInt(allowanceStr);

          if (allowanceBigInt < requiredBigInt) {
            console.log(
              "Token approval needed. Initiating approve transaction...",
            );

            await tokenContract.methods
              .approve(logicAddress, requiredAllowance)
              .send({
                from: registeredWallet,
                gas: "100000",
              })
              .on("transactionHash", (hash: string) => {
                console.log("Approval transaction hash:", hash);
              })
              .on("receipt", (receipt: any) => {
                console.log("Approval successful:", receipt);
              })
              .on("error", (error: any) => {
                console.error("Approval error:", error);
                throw new Error("Token approval failed. Please try again.");
              });

            console.log("Token approval completed.");
          } else {
            console.log("Sufficient allowance already granted.");
          }
        } catch (error: any) {
          if (error.message.includes("Insufficient token balance")) {
            throw error;
          }
          console.warn("Could not check token balance or allowance:", error);
        }
      }

      console.log("Sending transaction...");

      await logicContract.methods
        .submitBlockGuess(
          guessId,
          blockIncrement,
          dummyHashWith0x,
          tokenSize,
          paymentAmount,
          overwrite,
          complex,
        )
        .send({
          from: registeredWallet,
          gas: "500000",
        })
        .on("transactionHash", function (hash: string) {
          console.log("Transaction hash:", hash);
        })
        .on("receipt", function (receipt: any) {
          console.log("Transaction receipt received");

          const safeReceipt = convertBigIntToString(receipt);

          if (safeReceipt.status) {
            const events = safeReceipt.events;
            let emittedValues = null;
            let contractBlockNumber = blockIncrement.toString();

            if (events && events.guessSubmitted) {
              emittedValues = events.guessSubmitted.returnValues;
              console.log("Guess submitted successfully:", emittedValues);

              contractBlockNumber =
                emittedValues._guessBlockNumber ||
                emittedValues[2] ||
                emittedValues.guessBlockNumber ||
                blockIncrement.toString();
            }

            const exportableData: ExportableGuessData = {
              Sno: guessId,
              blockIncrementCount: blockIncrement,
              blockHashGuess: dummyHash,
              tokenSize: tokenSize,
              paymentPaidBet: paymentAmount,
              overWrite: overwrite,
              complex: complex,
              dummyHash: dummyHash,
              actualHash: actualHash,
              secretKey: secretHash,
              guessId: guessId,
              tokens: tokens,
              timestamp: Date.now(),
              txHash: safeReceipt.transactionHash,
              gasUsed: safeReceipt.gasUsed?.toString() || "0",
              formattedPayment: paidGuess ? "25 Tokens" : "Free",
              contractBlockNumber: contractBlockNumber,
            };

            // UPDATED: Save to wallet-specific localStorage
            const existingGuesses: ExportableGuessData[] = 
              getWalletLocalStorage(registeredWallet, "allGuessSubmissions") || [];

            const index = existingGuesses.findIndex(
              (g) => g.guessId === guessId,
            );

            if (index !== -1) {
              existingGuesses[index] = exportableData;
            } else {
              existingGuesses.push(exportableData);
            }

            setWalletLocalStorage(registeredWallet, "allGuessSubmissions", existingGuesses);
            setWalletLocalStorage(registeredWallet, "lastGuessSubmission", exportableData);

            // Store in Firebase
            const guessRef = ref(
              database,
              `guesses/${registeredWallet}/${guessId}`,
            );
            set(guessRef, exportableData).catch((err) => {
              console.error("Firebase storage error:", err);
            });

            setConfirmModal({
              isOpen: true,
              title: "Success!",
              message: `Guess submitted successfully!\n\nTransaction Hash: ${safeReceipt.transactionHash}\nGas Used: ${safeReceipt.gasUsed}\nWallet: ${registeredWallet}\nContract Block: ${contractBlockNumber}`,
              onConfirm: () => {
                setConfirmModal((prev) => ({ ...prev, isOpen: false }));
                navigate("/dashboard");
              },
              type: "success",
            });
          } else {
            throw new Error("Transaction failed");
          }
        })
        .on("error", function (error: any) {
          console.error("Transaction error:", error);
          throw error;
        });
    } catch (error: any) {
      console.error("Error submitting guess:", error);

      let errorMessage = "An error occurred while submitting the form.";

      if (
        error.message?.includes("User denied transaction signature") ||
        error.code === 4001
      ) {
        errorMessage = "User denied transaction signature.";
      } else if (
        error.message?.includes("Internal JSON-RPC error") ||
        error.code === -32603
      ) {
        errorMessage =
          "Please increase gas fee! Also check gas and network settings!";
      } else if (
        error.message?.includes("revert") ||
        error.message?.includes("execution reverted")
      ) {
        errorMessage =
          "Transaction reverted. This usually means:\n\n• Insufficient token balance for paid guess\n• Token approval needed for paid guess\n• Invalid guess parameters\n• Contract validation failed";
      } else if (error.message?.includes("gas")) {
        errorMessage =
          "Gas estimation failed. Please check:\n\n• Your token balance for paid guess\n• Token approval for smart contract\n• Network settings";
      } else if (error.message?.includes("Insufficient token balance")) {
        errorMessage = error.message;
      } else if (error.message?.includes("Logic contract")) {
        errorMessage = error.message;
      } else if (error.message?.includes("Wrong network")) {
        errorMessage = error.message;
      } else if (error.message?.includes("Token approval failed")) {
        errorMessage =
          "Token approval transaction failed. Please approve manually and retry.";
      } else if (error.message) {
        errorMessage = error.message;
      }

      setConfirmModal({
        isOpen: true,
        title: "Transaction Failed",
        message: errorMessage,
        onConfirm: () =>
          setConfirmModal((prev) => ({ ...prev, isOpen: false })),
        type: "error",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClear = () => {
    setConfirmModal({
      isOpen: true,
      title: "Clear Form",
      message:
        "Are you sure you want to clear all data? This will reset the entire form.",
      onConfirm: () => {
        setPaidGuess(false);
        setOverwrite(false);
        setComplex(false);
        setBlockIncrement(10);
        setActualHash("");
        setActualHashInput("");
        setSecretHash("");
        setSecretHashInput("");
        setDummyHash(ZERO_HASH);
        setTokenSize(3);
        setTokens([]);
        setIsFormReadonly(true);
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
      },
      type: "warning",
    });
  };

  const handleBack = () => {
    navigate("/dashboard");
  };

  return (
    <>
      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        title={confirmModal.title}
        message={confirmModal.message}
        onConfirm={confirmModal.onConfirm}
        onCancel={() =>
          setConfirmModal((prev) => ({ ...prev, isOpen: false }))
        }
        type={confirmModal.type}
        confirmText={confirmModal.confirmText}
        cancelText={confirmModal.cancelText}
      />
      <GuessUI
        guessId={guessId}
        paidGuess={paidGuess}
        overwrite={overwrite}
        complex={complex}
        blockIncrement={blockIncrement}
        actualHash={actualHash}
        secretHash={secretHash}
        dummyHash={dummyHash}
        tokenSize={tokenSize}
        tokens={tokens}
        isGeneratingActual={isGeneratingActual}
        isGeneratingSecret={isGeneratingSecret}
        isSubmitting={isSubmitting}
        isFormReadonly={isFormReadonly}
        onPaidGuessChange={handlePaidGuessChange}
        onOverwriteChange={handleOverwriteChange}
        onComplexChange={handleComplexChange}
        onBlockIncrementChange={handleBlockIncrementChange}
        onActualHashChange={handleActualHashChange}
        onSecretHashChange={handleSecretHashChange}
        onTokenSizeChange={handleTokenSizeChange}
        onGenerateActualHash={handleGenerateActualHash}
        onGenerateSecretHash={handleGenerateSecretHash}
        onSubmit={handleSubmit}
        onClear={handleClear}
        onBack={handleBack}
      />
    </>
  );
};

export default GuessPage;
