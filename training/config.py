"""
Configuration for the Jazz DistilGPT2 Training Pipeline.
"""
import os

# --- PATHS (Adjust these to match your Colab/Drive structure) ---
BASE_PATH = "/content/drive/MyDrive/TESIS/formatted"
TOKENS_PATH = os.path.join(BASE_PATH, "tokens.npy")
TRAIN_DATA_PATH = os.path.join(BASE_PATH, "dataset_train.npy")
TEST_DATA_PATH = os.path.join(BASE_PATH, "dataset_test.npy")

# Where to save the final model
OUTPUT_DIR = "/content/drive/MyDrive/TESIS/results_distilgpt2_jazz"

# --- HYPERPARAMETERS ---
MODEL_NAME = "distilgpt2"  # The base model from Hugging Face
BATCH_SIZE = 32            # 32 or 64 depending on GPU VRAM (T4 handles 32 easily)
EPOCHS = 10                # Pre-trained models converge faster than raw GPT2
LEARNING_RATE = 2e-4       # Standard fine-tuning rate
BLOCK_SIZE = 1024          # Context window size