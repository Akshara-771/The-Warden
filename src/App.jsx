import React, { useState, useEffect, useCallback, useRef } from "react";
import "./App.css";
import { invoke } from "@tauri-apps/api/core";
import * as tf from "@tensorflow/tfjs";
import * as faceLandmarksDetection from "@tensorflow-models/face-landmarks-detection";

// Global camera tracking
window.cameraStreams = new Set();
const CAMERA_TIMEOUT = 5000; // 5 second timeout for camera operations

const LoserOverlay = ({ onFinished, insult }) => {
  useEffect(() => {
    // Set the timer to close the window
    const timer = setTimeout(onFinished, 20000);

    return () => {
      clearTimeout(timer);
    };
  }, [onFinished]);

  return (
    <div className="ar-container">
      <div className="snapshot-container">
        <img
          src="/assets/donkey.png"
          alt="You are a donkey."
          className="loser-image"
        />
        <img
          src="/assets/pointing-finger.png"
          alt="The Warden points at you."
          className="pointing-finger"
        />
        <div className="sticker loser">LOSER</div>
        {insult && <div className="ai-insult-box">{insult}</div>}
      </div>
    </div>
  );
};

const AROverlay = ({ onFinished }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const animationCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const animationFrameId = useRef(null);
  const detectorRef = useRef(null);

  const [snapshot, setSnapshot] = useState(null);
  const [message, setMessage] = useState("Initializing...");
  const [setupFailed, setSetupFailed] = useState(false);

  const cleanupCamera = useCallback(async () => {
    console.log("Starting camera cleanup");

    try {
      if (streamRef.current) {
        // Stop all camera tracks
        const tracks = streamRef.current.getTracks();
        tracks.forEach((track) => {
          track.stop();
          window.cameraStreams?.delete(track);
        });

        // Clear video source
        if (videoRef.current) {
          videoRef.current.srcObject = null;
        } else {
          console.log("No active stream found");
        }

        streamRef.current = null;
        console.log("Camera tracks stopped");
      }

      // Wait for either cleanup or timeout
      await Promise.race([
        Promise.resolve(), // already done above
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
    } catch (err) {
      console.error("Cleanup error:", err);
    } finally {
      console.log("Notifying Rust of cleanup completion");
      try {
        console.log(">>> About to notify Rust of cleanup");
        await invoke("camera_cleanup_complete");
      } catch (err) {
        console.error("Failed to notify cleanup complete:", err);
      }
    }
  }, []);

  const playClickSound = () => {
    try {
      const audioContext = new (window.AudioContext ||
        window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(1000, audioContext.currentTime);
      gainNode.gain.setValueAtTime(1, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(
        0.0001,
        audioContext.currentTime + 0.05
      );
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.05);
    } catch (e) {
      console.error("Could not play sound:", e);
    }
  };

  useEffect(() => {
    const runSequence = async () => {
      try {
        setMessage("Initializing analysis engine...");
        await tf.ready();

        try {
          setMessage("Activating webcam...");
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480 },
          });
          streamRef.current = stream;
          stream
            .getTracks()
            .forEach((track) => window.cameraStreams.add(track));

          const video = videoRef.current;
          if (video) {
            video.srcObject = stream;
            await new Promise((resolve, reject) => {
              video.onloadedmetadata = resolve;
              video.onerror = reject;
            });
            await video.play();
          }

          try {
            setMessage("Loading Warden's analysis model...");
            const model =
              faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh;
            const detectorConfig = {
              runtime: "mediapipe",
              solutionPath: "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh",
            };
            detectorRef.current = await faceLandmarksDetection.createDetector(
              model,
              detectorConfig
            );

            setMessage("Prepare for judgment...");
            await new Promise((resolve) => setTimeout(resolve, 2000));

            const canvas = canvasRef.current;
            if (canvas) {
              const ctx = canvas.getContext("2d");
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              setSnapshot(canvas.toDataURL("image/png"));
            }
          } catch (modelErr) {
            console.log("Face detection failed, proceeding with snapshot only");
            const canvas = canvasRef.current;
            if (canvas && video) {
              const ctx = canvas.getContext("2d");
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              setSnapshot(canvas.toDataURL("image/png"));
            }
          }
        } catch (cameraErr) {
          console.log("Camera failed, using placeholder");
          setSnapshot("/assets/winner-placeholder.jpg");
          setSetupFailed(true);
        }

        playClickSound();
      } catch (err) {
        console.error("Setup failed:", err);
        setSnapshot("/assets/winner-placeholder.jpg");
        setSetupFailed(true);
      }
    };

    runSequence();

    return () => {
      cleanupCamera().catch(console.error);
      if (detectorRef.current) detectorRef.current.dispose();
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [cleanupCamera]);

  useEffect(() => {
    if (!snapshot) return;
    const timer = setTimeout(onFinished, 20000);
    return () => clearTimeout(timer);
  }, [snapshot, onFinished]);

  useEffect(() => {
    if (!snapshot || setupFailed) return;

    const canvas = animationCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let particles = [];

    for (let i = 0; i < 100; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height - canvas.height,
        size: Math.random() * 10 + 5,
        speed: Math.random() * 3 + 2,
        rotation: Math.random() * 360,
        color: `hsl(${Math.random() * 360}, 100%, 50%)`,
      });
    }

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach((p, index) => {
        p.y += p.speed;
        p.rotation += p.speed;
        ctx.fillStyle = p.color;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
        if (p.y > canvas.height) particles.splice(index, 1);
      });
      animationFrameId.current = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [snapshot, setupFailed]);

  return (
    <div className="ar-container">
      {!snapshot && <p className="ar-message">{message}</p>}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="ar-video"
        style={{ display: snapshot ? "none" : "block" }}
      ></video>
      <canvas
        ref={canvasRef}
        width="640"
        height="480"
        style={{ display: "none" }}
      ></canvas>
      {snapshot && (
        <div className="snapshot-container">
          <img
            src={snapshot}
            alt="Your moment of judgment"
            className="snapshot-image"
          />
          {!setupFailed && (
            <canvas
              ref={animationCanvasRef}
              width="640"
              height="480"
              className="animation-canvas"
            ></canvas>
          )}
          <div className="sticker winner">WINNER</div>
        </div>
      )}
    </div>
  );
};

const Grid = ({ currentGuess, guesses, solution }) => {
  return (
    <div className="game-board">
      {Array(5)
        .fill(0)
        .map((_, rowIndex) => {
          const guess =
            guesses[rowIndex] ||
            (rowIndex === guesses.length ? currentGuess : "");
          return (
            <Row
              key={rowIndex}
              guess={guess}
              solution={solution}
              isSubmitted={rowIndex < guesses.length}
            />
          );
        })}
    </div>
  );
};

const Row = ({ guess, solution, isSubmitted }) => {
  const getTileClass = (letter, index) => {
    if (!isSubmitted || !letter || letter === " ") return "";
    if (letter === solution[index]) return "green";
    if (solution.includes(letter)) return "yellow";
    return "gray";
  };

  const letters = (guess || "").padEnd(5, " ").split("");

  return (
    <div className="row">
      {letters.map((letter, i) => (
        <div key={i} className={`tile ${getTileClass(letter, i)}`}>
          {letter.trim()}
        </div>
      ))}
    </div>
  );
};

function App() {
  const [wordList, setWordList] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [solution, setSolution] = useState("");
  const [guesses, setGuesses] = useState([]);
  const [currentGuess, setCurrentGuess] = useState("");
  const [isGameOver, setIsGameOver] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [message, setMessage] = useState("");
  const [insult, setInsult] = useState("");
  useEffect(() => {
    const handleBeforeUnload = () => {
      console.log("Window closing - emergency cleanup");
      window.cameraStreams?.forEach((track) => track.stop());
      window.cameraStreams?.clear();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      handleBeforeUnload(); // Cleanup on unmount too
    };
  }, []);
  useEffect(() => {
    return () => {
      console.log("App unmounting - emergency cleanup");
      window.cameraStreams?.forEach((track) => track.stop());
      window.cameraStreams?.clear();
    };
  }, []);

  const generateInsult = async () => {
    setInsult("The Warden is contemplating your failure...");
    const prompt = `You are The Warden, a witty and condescending character. Directly insult a user who just failed a simple 5-letter word puzzle. The insult should be a single, complete sentence. Do not offer choices, use numbered lists, or use asterisks. (PromptID: ${Date.now()})`;
    try {
      const apiKey = import.meta.env.ITE_GEMINI_API_KEY;
      if (!apiKey) {
        setInsult("Even the AI pities you. That's how badly you lost.");
        return;
      }
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
      const payload = { contents: [{ parts: [{ text: prompt }] }] };
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok)
        throw new Error(`API request failed with status ${response.status}`);
      const result = await response.json();
      const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
      setInsult(text || "You've failed so badly, the AI is speechless.");
    } catch (error) {
      console.error("Error generating insult:", error);
      setInsult("Even the AI pities you. That's how badly you lost.");
    }
  };

  useEffect(() => {
    fetch("/solutions.json")
      .then((res) => res.json())
      .then((data) => {
        const upperCaseWords = data.map((word) => word.toUpperCase());
        setWordList(upperCaseWords);
        setSolution(
          upperCaseWords[Math.floor(Math.random() * upperCaseWords.length)]
        );
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("Could not load solutions.json:", err);
        const fallbackWords = ["REACT", "TAURI", "ERROR", "FILES", "DEBUG"];
        setWordList(fallbackWords);
        setSolution(
          fallbackWords[Math.floor(Math.random() * fallbackWords.length)]
        );
        setIsLoading(false);
      });
  }, []);

  const resetGame = useCallback(() => {
    if (wordList.length > 0) {
      const newSolution = wordList[Math.floor(Math.random() * wordList.length)];
      setSolution(newSolution);
      console.log(`The Warden has chosen a new word: ${newSolution}`);
    }
    setGuesses([]);
    setCurrentGuess("");
    setIsGameOver(false);
    setIsSuccess(false);
    setMessage("");
    setInsult("");
  }, [wordList]);

  const closeWarden = useCallback(async () => {
    console.log("Initiating window close sequence");
    try {
      window.cameraStreams?.forEach((track) => {
        console.log("Force-stopping track:", track);
        track.stop();
      });
      window.cameraStreams?.clear();
      await invoke("js_to_rust_hide_window");
      await invoke("camera_cleanup_complete");
    } catch (err) {
      console.error("Normal close failed:", err);
      window.cameraStreams?.forEach((track) => track.stop());
      window.cameraStreams?.clear();
    } finally {
      resetGame();
    }
  }, [resetGame]);

  const handleGuess = useCallback(() => {
    if (currentGuess.length !== 5) {
      setMessage("5 letters. No more, no less.");
      setTimeout(() => setMessage(""), 2000);
      return;
    }

    const newGuesses = [...guesses, currentGuess];
    setGuesses(newGuesses);
    setCurrentGuess("");

    const didWin = currentGuess === solution;
    const isLastGuess = newGuesses.length >= 5;

    if (didWin) {
      setIsSuccess(true);
      setIsGameOver(true);
    } else if (isLastGuess) {
      setIsSuccess(false);
      setIsGameOver(true);
      generateInsult();
    }
  }, [currentGuess, guesses, solution]);

  const handleKeyPress = useCallback(
    (key) => {
      if (isGameOver) return;
      const upperKey = key.toUpperCase();
      if (upperKey === "ENTER") {
        handleGuess();
      } else if (upperKey === "BACKSPACE" || upperKey === "BACK") {
        setCurrentGuess((prev) => prev.slice(0, -1));
      } else if (currentGuess.length < 5 && /^[A-Z]$/.test(upperKey)) {
        setCurrentGuess((prev) => prev + upperKey);
      }
    },
    [isGameOver, currentGuess.length, handleGuess]
  );

  useEffect(() => {
    const listener = (e) => handleKeyPress(e.key);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [handleKeyPress]);

  useEffect(() => {
    if (!isGameOver) return;

    const winAudio = new Audio("/sounds/win.mp3");
    const loseAudio = new Audio("/sounds/lose.mp3");

    if (isSuccess) {
      winAudio.play().catch((err) => console.error("Win audio error:", err));
    } else {
      loseAudio.play().catch((err) => console.error("Lose audio error:", err));
    }
  }, [isGameOver, isSuccess]);

  if (isLoading) {
    return (
      <div className="app-container">
        <p>Warden is loading his dictionary...</p>
      </div>
    );
  }

  if (isGameOver) {
    return isSuccess ? (
      <AROverlay onFinished={closeWarden} />
    ) : (
      <LoserOverlay onFinished={closeWarden} insult={insult} />
    );
  }

  return (
    <div className="app-container">
      <header>
        <img
          src="/assets/warden-title.png"
          alt="THE WARDEN"
          className="warden-title"
        />
        <p>Your focus is forfeit. Solve the puzzle.</p>
        <button
          onClick={() => invoke("exit_app")}
          style={{
            position: "absolute",
            top: "10px",
            right: "10px",
            padding: "5px 10px",
            cursor: "pointer",
            border: "none",
            background: "#ff5555",
            color: "white",
            borderRadius: "5px",
          }}
        >
          Exit App
        </button>
      </header>
      <Grid currentGuess={currentGuess} guesses={guesses} solution={solution} />
      {message && <div className="message-box">{message}</div>}
    </div>
  );
}

export default App;
