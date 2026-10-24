import json

# Настройки
input_file = 'floor1_graph.json'
output_file = 'nodes_floor1.json'
floor_number = 1

# Чтение исходного файла
with open(input_file, 'r', encoding='utf-8') as f:
    raw_nodes = json.load(f)

# Преобразование формата
formatted_nodes = {}
for node in raw_nodes:
    node_name = node['name'] # Извлекаем имя узла, например "stairs_D_south"
    formatted_nodes[node_name] = {
        "x": node['x'],
        "y": node['y'],
        "floor": floor_number
    }

# Сохранение в новый файл
with open(output_file, 'w', encoding='utf-8') as f:
    json.dump(formatted_nodes, f, ensure_ascii=False, indent=4)

print(f"Готово! Обработано {len(formatted_nodes)} узлов.")