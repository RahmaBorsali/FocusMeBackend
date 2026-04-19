const express = require("express");
const router = express.Router();
const MusicPack = require("../models/MusicPack");
const User = require("../models/user");
const { ApiError } = require("../utils/api");
const { requireAuth } = require("../middleware/auth");

// 1. Lister tous les packs disponibles
router.get("/packs", async (req, res, next) => {
  try {
    const packs = await MusicPack.find().select("-tracks"); 
    res.json(packs);
  } catch (error) {
    next(error);
  }
});

// 2. Récupérer les morceaux des abonnements de l'utilisateur
router.get("/my-tracks", requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.userId).populate("musicSubscriptions");
    if (!user) throw new ApiError(404, "User not found");

    let allTracks = [];
    user.musicSubscriptions.forEach(pack => {
      pack.tracks.forEach(track => {
        allTracks.push({
          ...track.toObject(),
          packName: pack.name,
          packId: pack._id
        });
      });
    });

    res.json(allTracks);
  } catch (error) {
    next(error);
  }
});

// 3. S'abonner / Se désabonner d'un pack
router.post("/subscribe", requireAuth, async (req, res, next) => {
  try {
    const { packId, subscribe } = req.body;
    const user = await User.findById(req.userId);
    
    if (subscribe) {
      if (!user.musicSubscriptions.includes(packId)) {
        user.musicSubscriptions.push(packId);
      }
    } else {
      user.musicSubscriptions = user.musicSubscriptions.filter(id => id.toString() !== packId);
    }

    await user.save();
    res.json({ success: true, subscriptions: user.musicSubscriptions });
  } catch (error) {
    next(error);
  }
});

// 4. Route de SEED (Pour créer des données de test au démarrage)
router.post("/seed", async (req, res, next) => {
  try {
    const count = await MusicPack.countDocuments();
    if (count > 0) return res.json({ message: "Database already seeded" });

    const demoPacks = [
      {
        name: "Lofi Focus",
        description: "Beats calmes pour une concentration profonde.",
        category: "Lofi",
        imageUrl: "https://images.unsplash.com/photo-1516280440614-37939bbacd81?q=80&w=200&h=200&auto=format&fit=crop",
        tracks: [
          { title: "Midnight Study", artist: "FocusMe Lofi", audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" },
          { title: "Rainy Window", artist: "FocusMe Lofi", audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3" }
        ]
      },
      {
        name: "Nature Ambient",
        description: "Sons de la nature pour apaiser l'esprit.",
        category: "Nature",
        imageUrl: "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?q=80&w=200&h=200&auto=format&fit=crop",
        tracks: [
          { title: "Forest Walk", artist: "Nature Sounds", audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3" },
          { title: "Ocean Waves", artist: "Nature Sounds", audioUrl: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3" }
        ]
      }
    ];

    await MusicPack.insertMany(demoPacks);
    res.json({ message: "Seed successful", packs: demoPacks.length });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
