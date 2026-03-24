"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import io from "socket.io-client";

// Replace with your public HTTPS backend URL (ngrok, Render, etc.)
const socket = io("https://facechatappbackend.onrender.com");

type RemoteStream = { id: string; stream: MediaStream };

export default function RoomPage() {
  const { roomId } = useParams();

  const localVideo = useRef<HTMLVideoElement | null>(null);
  const localStream = useRef<MediaStream | null>(null);

  const [remoteStreams, setRemoteStreams] = useState<RemoteStream[]>([]);

  // Track each peer: pc + isOfferer
  const peers = useRef<{ [id: string]: { pc: RTCPeerConnection; isOfferer: boolean } }>({});

  // Queue ICE candidates until remote description is set
  const pendingCandidates = useRef<{ [id: string]: RTCIceCandidateInit[] }>({});

  useEffect(() => {
    if (!roomId) return;
    init();

    return () => {
      socket.disconnect();
      Object.values(peers.current).forEach(({ pc }) => pc.close());
    };
  }, [roomId]);

  async function init() {
    // 1️⃣ Get local media
    localStream.current = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    if (localVideo.current) localVideo.current.srcObject = localStream.current;

    // 2️⃣ Join room
    socket.emit("join", roomId);

    // 3️⃣ Receive all users
    socket.on("all-users", (users: string[]) => {
      users.forEach((userId) => createOffer(userId));
    });

    // 4️⃣ New user joined
    socket.on("user-joined", (userId: string) => {
      createOffer(userId);
    });

    // 5️⃣ Receive offer
    socket.on("offer", async ({ offer, from }) => {
      if (peers.current[from]) return;

      const pc = createPeerConnection(from);
      peers.current[from] = { pc, isOfferer: false };

      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      // Flush any queued ICE candidates
      if (pendingCandidates.current[from]) {
        for (const c of pendingCandidates.current[from]) {
          try {
            await pc.addIceCandidate(c);
          } catch (e) {
            console.error("Error adding queued ICE candidate:", e);
          }
        }
        pendingCandidates.current[from] = [];
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit("answer", { answer, to: from });
    });

    // 6️⃣ Receive answer
    socket.on("answer", async ({ answer, from }) => {
      const pc = peers.current[from]?.pc;
      if (!pc) return;

      await pc.setRemoteDescription(new RTCSessionDescription(answer));

      // Flush queued ICE candidates
      if (pendingCandidates.current[from]) {
        for (const c of pendingCandidates.current[from]) {
          try { await pc.addIceCandidate(c); } catch (e) {}
        }
        pendingCandidates.current[from] = [];
      }
    });

    // 7️⃣ Receive ICE candidate
    socket.on("ice-candidate", async ({ candidate, from }) => {
      const pc = peers.current[from]?.pc;
      if (!pc) return;

      if (!pc.remoteDescription || pc.remoteDescription.type === null) {
        // Remote description not set yet — queue candidate
        if (!pendingCandidates.current[from]) pendingCandidates.current[from] = [];
        pendingCandidates.current[from].push(candidate);
      } else {
        try {
          await pc.addIceCandidate(candidate);
        } catch (err) {
          console.error("Failed to add ICE candidate:", err);
        }
      }
    });

    // 8️⃣ User left
    socket.on("user-left", (userId: string) => {
      if (peers.current[userId]) {
        peers.current[userId].pc.close();
        delete peers.current[userId];
      }
      setRemoteStreams((prev) => prev.filter((s) => s.id !== userId));
    });
  }

  // Create peer connection per user
  function createPeerConnection(userId: string) {
    if (peers.current[userId]?.pc) return peers.current[userId].pc;

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        {
          urls: "turn:YOUR_SERVER_IP:3478", // <-- replace with your TURN server
          username: "facechatuser",
          credential: "strongpassword123",
        },
      ],
    });

    // Add local tracks
    localStream.current?.getTracks().forEach((track) => pc.addTrack(track, localStream.current!));

    // Handle remote tracks
    pc.ontrack = (event) => {
      setRemoteStreams((prev) => {
        const existing = prev.find((s) => s.id === userId);
        if (existing) {
          event.streams[0].getTracks().forEach((track) => {
            if (!existing.stream.getTracks().find((t) => t.id === track.id)) {
              existing.stream.addTrack(track);
            }
          });
          return [...prev];
        }
        return [...prev, { id: userId, stream: event.streams[0] }];
      });
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("ice-candidate", { candidate: event.candidate, to: userId, from: socket.id });
      }
    };

    return pc;
  }

  // Create offer for a new user
  async function createOffer(userId: string) {
    if (peers.current[userId]) return;

    const pc = createPeerConnection(userId);
    peers.current[userId] = { pc, isOfferer: true };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.emit("offer", { offer, to: userId, from: socket.id });
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>Room: {roomId}</h1>

      <video
        ref={localVideo}
        autoPlay
        muted
        playsInline
        style={{ width: 200, border: "2px solid green" }}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, 200px)",
          gap: 10,
          marginTop: 20,
        }}
      >
        {remoteStreams.map(({ id, stream }) => (
          <RemoteVideo key={id} stream={stream} />
        ))}
      </div>
    </div>
  );
}

// Component for remote video
function RemoteVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) {
      ref.current.srcObject = stream;
      ref.current.play().catch(() => {});
    }
  }, [stream]);

  return <video ref={ref} autoPlay playsInline style={{ width: 200, border: "2px solid blue" }} />;
}