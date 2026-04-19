const mongoose = require("mongoose");

const TrackSchema = new mongoose.Schema({
  title: { type: String, required: true },
  artist: { type: String, default: "FocusMe Artist" },
  audioUrl: { type: String, required: true },
  artworkUrl: { type: String, default: "" },
  durationSeconds: { type: Number, default: 0 }
});

const MusicPackSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    description: { type: String, default: "" },
    category: { type: String, default: "Focus" }, // e.g., Lofi, Nature, Ambient
    imageUrl: { type: String, default: "" },
    isFree: { type: Boolean, default: true },
    tracks: [TrackSchema]
  },
  { timestamps: true }
);

module.exports = mongoose.model("MusicPack", MusicPackSchema);
