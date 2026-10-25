# 首尔服务器卡拉 OK 容量评估

补充设备检查：PCI 显示设备为 Cirrus Logic GD 5446 虚拟显卡，未发现 NVIDIA 设备；不能作为模型计算或现代视频编码加速器。Python 3.12.3；最近负载 0.02/0.01/0.00，短暂 vmstat 采样 CPU 空闲 99–100%，无持续换入换出。FFmpeg 未在 PATH 中找到。以上仅为空闲状态快照，不是制作性能测试。

2026-10-25 只读 SSH 观测：2 vCPU，Intel Xeon Platinum 8255C 2.50GHz，x86_64；内存总计 3723、已用 932、可用 2791 MiB；Swap 1987 MiB，几乎未用；根盘 59 GiB，已用 16、可用 42 GiB；Node RSS 367244 KiB。`command -v ffmpeg/nvidia-smi` 返回空，不能据此证明无 GPU。

据[官方 README](https://github.com/BilyHurington/MiliKara/blob/main/README.md)：支持 Linux CPU，需 Python ≥3.11、ffmpeg、libass；对齐与分离模型磁盘占用约 1.2 GB、1 GB。[技术文档](https://github.com/BilyHurington/MiliKara/blob/main/docs/technical.md)说明分离可选，并有 libx264 回退。

判断：保留原唱、不做分离的简化视频流程，单任务可能可行；约 2.7 GiB 可用内存能否支撑完整流程，未经运行峰值测试不能确认。模型磁盘大小不等于运行内存，Swap 也不是 RAM。已查阅文档未公布最低内存或任务耗时。

未实际安装模型或执行基准测试。建议先用资源与时间受限的隔离短片单任务测试，记录峰值内存、Swap、耗时及结果，再测试完整歌曲。
