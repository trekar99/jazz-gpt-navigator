import torch
from transformers import GPT2LMHeadModel, Trainer, TrainingArguments
import config
from dataset import MusicDataset, load_vocab_and_data

def main():
    print("============================================")
    print("   🎷 JAZZ DISTILGPT-2 TRAINING PIPELINE    ")
    print("============================================")

    # 1. LOAD DATA & VOCAB
    # ====================
    tokens, token_to_id, train_data_raw = load_vocab_and_data(
        config.TOKENS_PATH, 
        config.TRAIN_DATA_PATH
    )
    
    # Define Special Tokens
    PAD_TOKEN_ID = token_to_id.get('<pad>')
    EOS_TOKEN_ID = token_to_id.get('<end>')
    BOS_TOKEN_ID = token_to_id.get('<start>')
    
    print(f"✅ Vocabulary Size: {len(tokens)}")

    # 2. PREPARE DATASET
    # ==================
    print("🛠️  Creating PyTorch Dataset...")
    train_dataset = MusicDataset(train_data_raw, token_to_id)

    # 3. LOAD & ADAPT MODEL
    # =====================
    print(f"🚀 Loading pre-trained {config.MODEL_NAME}...")
    model = GPT2LMHeadModel.from_pretrained(config.MODEL_NAME)

    # --- CRITICAL STEP: RESIZE EMBEDDINGS ---
    # DistilGPT2 has ~50k tokens (English). We resize it to ~160 (Jazz Chords).
    # This saves massive memory and compute.
    print(f"📉 Resizing Model Embeddings: {model.config.vocab_size} -> {len(tokens)}")
    model.resize_token_embeddings(len(tokens))

    # Update config with our special tokens
    model.config.pad_token_id = PAD_TOKEN_ID
    model.config.bos_token_id = BOS_TOKEN_ID
    model.config.eos_token_id = EOS_TOKEN_ID

    # 4. TRAINING ARGUMENTS
    # =====================
    training_args = TrainingArguments(
        output_dir=config.OUTPUT_DIR,
        overwrite_output_dir=True,
        num_train_epochs=config.EPOCHS,
        per_device_train_batch_size=config.BATCH_SIZE,
        save_steps=1000,
        save_total_limit=2,
        learning_rate=config.LEARNING_RATE,
        logging_steps=50,
        prediction_loss_only=True,
        remove_unused_columns=False,
        dataloader_drop_last=True,
        fp16=torch.cuda.is_available(), # Use Mixed Precision if GPU is available (Much Faster)
    )

    # 5. INITIALIZE TRAINER
    # =====================
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
    )

    # 6. START TRAINING
    # =================
    print("🔥 Starting Training...")
    trainer.train()

    # 7. SAVE FINAL MODEL
    # ===================
    final_save_path = f"{config.OUTPUT_DIR}/distilgpt2_jazz_final"
    print(f"💾 Saving model to {final_save_path}...")
    model.save_pretrained(final_save_path)
    
    print("🎉 Training Complete! Download the folder and move to Phase 2.")

if __name__ == "__main__":
    main()