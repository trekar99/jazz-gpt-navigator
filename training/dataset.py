import torch
import numpy as np
from torch.utils.data import Dataset

class MusicDataset(Dataset):
    """
    Custom PyTorch Dataset for Jazz Chord Progressions.
    """
    def __init__(self, data_array, tokenizer_map):
        self.data = data_array
        self.tokenizer = tokenizer_map
        # Get special token IDs from the map
        self.pad_id = tokenizer_map.get('<pad>', 0)
        self.unk_id = tokenizer_map.get('<unk>', self.pad_id)

    def __len__(self):
        return len(self.data)

    def __getitem__(self, idx):
        # 1. Get the row of tokens (strings)
        row = self.data[idx]

        # 2. Convert strings to IDs
        input_ids = []
        for token in row:
            token_str = str(token)
            if token_str in self.tokenizer:
                input_ids.append(self.tokenizer[token_str])
            else:
                input_ids.append(self.unk_id)

        # 3. Create Tensor
        input_tensor = torch.tensor(input_ids, dtype=torch.long)
        
        # 4. Create Labels (Mask padding for loss calculation)
        labels = input_tensor.clone()
        labels[labels == self.pad_id] = -100

        return {
            "input_ids": input_tensor,
            "labels": labels,
            "attention_mask": (input_tensor != self.pad_id).long()
        }

def load_vocab_and_data(tokens_path, train_path):
    """
    Helper function to load .npy files and create mappings.
    """
    print(f"📂 Loading vocabulary from {tokens_path}...")
    tokens = np.load(tokens_path, allow_pickle=True)
    
    # Create mappings
    token_to_id = {token: i for i, token in enumerate(tokens)}
    id_to_token = {i: token for i, token in enumerate(tokens)}
    
    print(f"📂 Loading training data from {train_path}...")
    train_data = np.load(train_path, allow_pickle=True).tolist()
    
    return tokens, token_to_id, train_data