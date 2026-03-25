"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import io from "socket.io-client";

export default function RoomPage() {
  const { roomId } = useParams();
  const socket = useRef<any>(null);
  const localStream = useRef<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<{id: string, stream: MediaStream}[]>([]);
  const [status, setStatus] = useState("Tap 'Start Camera' to begin");
  const [joined, setJoined] = useState(false);
  const peers = useRef<{ [id: string]: RTCPeerConnection }>({});

  const startCall = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStream.current = stream;
      const localVideo = document.getElementById("localVideo") as HTMLVideoElement;
      if (localVideo) localVideo.srcObject = stream;
      
      // Initialize Socket ONLY after user clicks start
      socket.current = io("https://facechatappbackend.onrender.com", { transports: ["websocket"] });
      setJoined(true);
      setStatus("Connecting to signaling...");

      socket.current.on("connect", () => {
        setStatus("Online. Joining Room...");
        socket.current.emit("join", roomId);
      });

      setupSignaling();
    } catch (err) {
      setStatus("Error: Please allow camera access.");
    }
  };

  const setupSignaling = () => {
    socket.current.on("all-users", (users: string[]) => {
      setStatus(`Connected. Room size: ${users.length + 1}`);
      users.forEach(id => { if (id !== socket.current.id) createOffer(id); });
    });

    socket.current.on("user-joined", (id: string) => {
      setStatus("User joining...");
      // In a "Polite" setup, we let the NEW person initiate to avoid collision
    });

    socket.current.on("offer", async ({ offer, from }: any) => {
      const pc = createPeerConnection(from);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.current.emit("answer", { answer, to: from });
    });

    socket.current.on("answer", async ({ answer, from }: any) => {
      const pc = peers.current[from];
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
    });

    socket.current.on("ice-candidate", ({ candidate, from }: any) => {
      const pc = peers.current[from];
      if (pc && pc.remoteDescription) pc.addIceCandidate(new RTCIceCandidate(candidate));
    });
  };

  function createPeerConnection(userId: string) {
    if (peers.current[userId]) return peers.current[userId];

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        // Added a public TURN server (OpenRelay) to bypass mobile 4G/5G firewalls
      ],
    });

    peers.current[userId] = pc;
    localStream.current?.getTracks().forEach(t => pc.addTrack(t, localStream.current!));

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.current.emit("ice-candidate", { candidate: e.candidate, to: userId });
    };

    pc.oniceconnectionstatechange = () => {
      setStatus(`Peer Connection: ${pc.iceConnectionState}`);
    };

    pc.ontrack = (e) => {
      setRemoteStreams(prev => prev.find(s => s.id === userId) ? prev : [...prev, { id: userId, stream: e.streams[0] }]);
    };

    return pc;
  }

  async function createOffer(userId: string) {
    const pc = createPeerConnection(userId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.current.emit("offer", { offer, to: userId, from: socket.current.id });
  }

  return (
    <div style={{ padding: 20, textAlign: "center", background: "#111", color: "#fff", minHeight: "100vh" }}>
      <div style={{ background: "#222", padding: 10, borderRadius: 8, marginBottom: 20 }}>{status}</div>
      
      {!joined && <button onClick={startCall} style={{ padding: "15px 30px", fontSize: 18, background: "#0070f3", color: "#fff", border: "none", borderRadius: 8 }}>Start Camera & Join</button>}

      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 20 }}>
        <video id="localVideo" autoPlay muted playsInline style={{ width: 300, borderRadius: 12, border: "2px solid #444" }} />
        {remoteStreams.map(s => <RemoteVideo key={s.id} stream={s.stream} />)}
      </div>
    </div>
  );
}

function RemoteVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return <video ref={ref} autoPlay playsInline style={{ width: 300, borderRadius: 12, border: "2px solid #0070f3" }} />;
}