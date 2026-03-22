"use client";

import { useEffect, useRef } from "react";
import io from "socket.io-client";

// Use ngrok / LAN IP / Cloudflare Tunnel URL
const socket = io("http://192.168.77.229:3001"); // Replace with your backend URL

export default function Home() {
  const localVideo = useRef<any>(null);
  const remoteVideo = useRef<any>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const roomId = "room-1";

  useEffect(() => {
    start();
  }, []);

  async function start() {
    // 1️⃣ Get local media
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: true,
    });

    if (localVideo.current) localVideo.current.srcObject = stream;

    // 2️⃣ Create peer connection
    peerConnection.current = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    // 3️⃣ Add local tracks
    stream.getTracks().forEach((track) => {
      peerConnection.current?.addTrack(track, stream);
    });

    // 4️⃣ Remote track
    peerConnection.current.ontrack = (event) => {
      if (remoteVideo.current?.srcObject !== event.streams[0]) {
        remoteVideo.current.srcObject = event.streams[0];
      }
    };

    // 5️⃣ ICE candidates
    peerConnection.current.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("ice-candidate", { candidate: event.candidate, roomId });
      }
    };

    // 6️⃣ Join room
    socket.emit("join", roomId);

    // 7️⃣ Signaling
    socket.on("user-joined", async (otherSocketId: string) => {
      if (!peerConnection.current) return;
      const offer = await peerConnection.current.createOffer();
      await peerConnection.current.setLocalDescription(offer);

      socket.emit("offer", {
        offer: {
          type: offer.type,
          sdp: offer.sdp,
        },
        to: otherSocketId,
      });
    });

    socket.on("offer", async ({ offer, from }) => {
      if (!peerConnection.current || !offer) return;

      await peerConnection.current.setRemoteDescription(
        new RTCSessionDescription({ type: offer.type, sdp: offer.sdp })
      );

      const answer = await peerConnection.current.createAnswer();
      await peerConnection.current.setLocalDescription(answer);

      socket.emit("answer", { answer: { type: answer.type, sdp: answer.sdp }, to: from });
    });

    socket.on("answer", async ({ answer }) => {
      if (!peerConnection.current || !answer) return;
      await peerConnection.current.setRemoteDescription(
        new RTCSessionDescription({ type: answer.type, sdp: answer.sdp })
      );
    });

    socket.on("ice-candidate", async ({ candidate }) => {
      if (candidate && peerConnection.current) {
        try {
          await peerConnection.current.addIceCandidate(candidate);
        } catch (err) {
          console.error("Error adding ICE candidate:", err);
        }
      }
    });
  }

  return (
    <div>
      <h1>Video Call</h1>
      <video ref={localVideo} autoPlay playsInline muted style={{ width: 200 }} />
      <video ref={remoteVideo} autoPlay playsInline style={{ width: 200 }} />
    </div>
  );
}