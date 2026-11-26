"""Run the ketos CLI with BatchNorm layers frozen (always in eval mode).

Why: fine-tuning PP-OCRv6 with ketos updates every BatchNorm running statistic
from the small, padded fine-tuning batches. On the Toledano manuscript one epoch
at a learning rate of 1e-9 (weights changed by < 1e-10) dropped test accuracy
from 96.38% to 88.63%; copying the base model's BatchNorm statistics back
restored exactly 96.38%. Keeping BatchNorm in eval mode during training keeps
the statistics of the base model, which is the usual way to fine-tune on little
data. Weights (including BatchNorm's scale and shift) still train.

Usage: python -m maatik_engine.ketos_frozen_bn <ketos arguments...>
"""

import sys

import torch.nn as nn

_original_train = nn.modules.batchnorm._BatchNorm.train


def _always_eval(self, mode: bool = True):
    return _original_train(self, False)


nn.modules.batchnorm._BatchNorm.train = _always_eval


def main() -> None:
    from kraken.ketos import cli

    sys.argv[0] = "ketos"
    cli()


if __name__ == "__main__":
    main()
