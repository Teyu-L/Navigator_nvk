import json

input_file = 'nodes_floor1.json'
output_file = 'nodes_floor1_merged.json'

with open(input_file, 'r', encoding='utf-8') as f:
    nodes = json.load(f)

merged_nodes = {}
coord_map = {} # (x, y, floor): node_name

for node_name, data in nodes.items():
    coord = (data['x'], data['y'], data.get('floor', 1))
    
    if coord in coord_map:
        # Координата уже существует, сливаем имена
        existing_name = coord_map[coord]
        new_name = f"{existing_name}_{node_name}"
        
        # Перезаписываем данные под объединенным именем
        merged_nodes[new_name] = merged_nodes.pop(existing_name)
        coord_map[coord] = new_name
        
        print(f"Объединены: {existing_name} и {node_name} -> {new_name}")
    else:
        merged_nodes[node_name] = data
        coord_map[coord] = node_name

with open(output_file, 'w', encoding='utf-8') as f:
    json.dump(merged_nodes, f, ensure_ascii=False, indent=4)

print(f"Очистка завершена. Осталось уникальных узлов: {len(merged_nodes)}")