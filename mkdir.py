import os

def create_folders(folder_path, start_num, end_num):
    """
    在指定文件夹中创建多个以'a'+数字命名的文件夹
    
    参数:
    folder_path: 目标文件夹路径
    start_num: 起始数字
    end_num: 结束数字（包含）
    """
    # 检查目标文件夹是否存在，如果不存在则创建
    if not os.path.exists(folder_path):
        os.makedirs(folder_path)
        print(f"创建目标文件夹: {folder_path}")
    
    # 循环创建文件夹
    for num in range(start_num, end_num + 1):
        folder_name = f"{num}"  # 文件夹名称格式：a1, a2, a3...
        full_path = os.path.join(folder_path, folder_name)
        
        try:
            os.makedirs(full_path, exist_ok=True)
            print(f"已创建文件夹: {full_path}")
        except Exception as e:
            print(f"创建文件夹 {full_path} 时出错: {e}")

# 使用示例
if __name__ == "__main__":
    # 设置参数
    target_folder = r"E:\solo3"  # 替换为你的目标文件夹路径
    start_number = 1                   # 起始数字
    end_number = 100                    # 结束数字
    
    # 调用函数创建文件夹
    create_folders(target_folder, start_number, end_number)
    
    print("\n所有文件夹创建完成！")