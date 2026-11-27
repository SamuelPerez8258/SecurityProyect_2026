-- Descontar stock automáticamente al insertar un ítem en la orden
CREATE OR REPLACE FUNCTION decrease_product_stock()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE booster_packs
    SET stock = stock - NEW.quantity
    WHERE id = NEW.booster_pack_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_decrease_stock
AFTER INSERT ON order_items
FOR EACH ROW
EXECUTE FUNCTION decrease_product_stock();


-- Validar que haya suficiente stock antes de permitir la compra
CREATE OR REPLACE FUNCTION check_stock_availability()
RETURNS TRIGGER AS $$
DECLARE
    current_stock INT;
BEGIN
    SELECT stock INTO current_stock 
    FROM booster_packs 
    WHERE id = NEW.booster_pack_id;

    IF current_stock < NEW.quantity THEN
        RAISE EXCEPTION 'No hay suficiente stock para este sobre. Stock disponible: %', current_stock;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_check_stock
BEFORE INSERT ON order_items
FOR EACH ROW
EXECUTE FUNCTION check_stock_availability();