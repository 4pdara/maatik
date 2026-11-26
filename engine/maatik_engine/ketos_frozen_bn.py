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
import torch.nn.functional as F


def _frozen_forward(self, input):
    # Normalise with the stored (base model) statistics and never update them,
    # whatever train/eval mode kraken or Lightning puts the layer in. (Overriding
    # train() alone was not enough: the statistics still changed.)
    self._check_input_dim(input)
    return F.batch_norm(input, self.running_mean, self.running_var, self.weight,
                        self.bias, False, 0.0, self.eps)


nn.modules.batchnorm._BatchNorm.forward = _frozen_forward


def main() -> None:
    from kraken.ketos import cli

    sys.argv[0] = "ketos"
    cli()


if __name__ == "__main__":
    main()
